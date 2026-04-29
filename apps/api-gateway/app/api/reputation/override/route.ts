import { NextRequest, NextResponse } from 'next/server'
import IORedis from 'ioredis'
import { resolveClientId } from '@/lib/client-context'
import { transaction } from '@/lib/db'

type Provider = 'gmail' | 'outlook' | 'yahoo' | 'other'
type OverrideAction = 'pause' | 'resume'

const REGION = process.env.XV_REGION ?? 'local'
const PROVIDERS: Provider[] = ['gmail', 'outlook', 'yahoo', 'other']

let redis: IORedis | null = null

function getRedis() {
  const url = process.env.REDIS_URL
  if (!url) throw new Error('Missing required env var: REDIS_URL')
  if (!redis) redis = new IORedis(url, { maxRetriesPerRequest: 2 })
  return redis
}

function normalizeProvider(value: unknown): Provider | null {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw || raw === 'all') return null
  if (raw === 'icloud') return 'other'
  if (raw === 'gmail' || raw === 'outlook' || raw === 'yahoo' || raw === 'other') return raw
  return null
}

function normalizeAction(value: unknown): OverrideAction | null {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw === 'pause' || raw === 'resume') return raw
  return null
}

function providerLabel(provider: Provider) {
  if (provider === 'other') return 'iCloud'
  return provider[0].toUpperCase() + provider.slice(1)
}

function buildSignal(input: {
  clientId: number
  domainId: number
  provider: Provider
  action: OverrideAction
  domain: string
}) {
  const paused = input.action === 'pause'
  const maxPerHour = paused ? 0 : 50
  const maxPerMinute = paused ? 0 : 1
  const maxConcurrency = paused ? 0 : 1
  const cooldownUntil = paused ? new Date(Date.now() + 60 * 60 * 1000).toISOString() : null
  const reasons = [paused ? 'manual_override_pause' : 'manual_override_resume']
  const metrics = {
    deferralRate1h: 0,
    blockRate1h: 0,
    sendSuccessRate1h: 1,
    seedPlacementInboxRate: 1,
    providerRisk: paused ? 1 : 0,
    override: true,
    overrideAt: new Date().toISOString(),
  }

  return {
    signal: {
      clientId: input.clientId,
      domainId: input.domainId,
      provider: input.provider,
      state: paused ? 'paused' : 'warmup',
      action: paused ? 'pause' : 'resume',
      maxPerHour,
      maxPerMinute,
      maxConcurrency,
      ratePerSecond: maxPerHour > 0 ? maxPerHour / 3600 : 0,
      burst: maxPerHour > 0 ? Math.max(1, Math.min(25, Math.ceil(maxPerHour / 12))) : 0,
      jitterPct: 0.15,
      cooldownUntil,
      reasons,
      metrics,
    },
    persistence: {
      state: paused ? 'paused' : 'warmup',
      maxPerHour,
      maxPerMinute,
      maxConcurrency,
      cooldownUntil,
      reasons,
      metricsSnapshot: {
        metrics,
        override: {
          source: 'admin_dashboard',
          action: input.action,
          domain: input.domain,
          provider: input.provider,
        },
      },
    },
  }
}

function overrideMessage(input: {
  action: OverrideAction
  provider: Provider
  domain: string
  bulk: boolean
}) {
  if (input.action === 'pause') {
    return input.bulk
      ? `Manual override paused ${providerLabel(input.provider)} lane for ${input.domain} during Pause All.`
      : `Manual override paused ${providerLabel(input.provider)} lane for ${input.domain}.`
  }

  return input.bulk
    ? `Manual override resumed ${providerLabel(input.provider)} lane for ${input.domain} at safe-ramp 50/hr during Resume All.`
    : `Manual override resumed ${providerLabel(input.provider)} lane for ${input.domain} at safe-ramp 50/hr.`
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const clientId = await resolveClientId({ body, headers: request.headers })
    const rawDomainId = body.domain_id ?? body.domainId
    const domainId =
      rawDomainId === undefined || rawDomainId === null || rawDomainId === ''
        ? null
        : Number(rawDomainId)
    const rawProvider = String(body.provider ?? '').trim().toLowerCase()
    const hasSpecificProvider = Boolean(rawProvider && rawProvider !== 'all')
    const provider = normalizeProvider(body.provider)
    const action = normalizeAction(body.action)
    const providers = provider ? [provider] : PROVIDERS

    if (domainId !== null && (!Number.isFinite(domainId) || domainId <= 0)) {
      return NextResponse.json({ ok: false, error: 'domain_id must be a positive number when provided' }, { status: 400 })
    }
    if (hasSpecificProvider && !provider) {
      return NextResponse.json({ ok: false, error: 'provider must be gmail, outlook, yahoo, other, icloud, or all' }, { status: 400 })
    }
    if (!action) {
      return NextResponse.json({ ok: false, error: 'action must be pause or resume' }, { status: 400 })
    }

    const result = await transaction(async (exec) => {
      const domainParams: unknown[] = [clientId]
      const domainWhere = ['client_id = $1']
      if (domainId !== null) {
        domainParams.push(domainId)
        domainWhere.push(`id = $${domainParams.length}`)
      }

      const domainRes = await exec<{ id: string | number; domain: string }>(
        `SELECT id, domain
         FROM domains
         WHERE ${domainWhere.join(' AND ')}
         ORDER BY domain ASC`,
        domainParams
      )

      if (!domainRes.rows.length) {
        return { notFound: true as const, lanes: [] }
      }

      const lanes: Array<{
        domainId: number
        domain: string
        provider: Provider
        signal: ReturnType<typeof buildSignal>['signal']
        message: string
      }> = []
      const bulk = domainRes.rows.length > 1 || providers.length > 1

      for (const domainRow of domainRes.rows) {
        const currentDomainId = Number(domainRow.id)
        for (const currentProvider of providers) {
          const previousRes = await exec<{
            state: string
            max_per_hour: number | string
            max_per_minute: number | string
            max_concurrency: number | string
            cooldown_until: string | null
            reasons: unknown
          }>(
            `SELECT state, max_per_hour, max_per_minute, max_concurrency, cooldown_until, reasons
             FROM reputation_state
             WHERE client_id = $1 AND domain_id = $2 AND provider = $3
             LIMIT 1`,
            [clientId, currentDomainId, currentProvider]
          )

          const { signal, persistence } = buildSignal({
            clientId,
            domainId: currentDomainId,
            provider: currentProvider,
            action,
            domain: domainRow.domain,
          })

          await exec(
            `INSERT INTO reputation_state (
               client_id,
               domain_id,
               provider,
               state,
               max_per_hour,
               max_per_minute,
               max_concurrency,
               cooldown_until,
               reasons,
               metrics_snapshot,
               updated_at
             )
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,CURRENT_TIMESTAMP)
             ON CONFLICT (client_id, domain_id, provider)
             DO UPDATE SET
               state = EXCLUDED.state,
               max_per_hour = EXCLUDED.max_per_hour,
               max_per_minute = EXCLUDED.max_per_minute,
               max_concurrency = EXCLUDED.max_concurrency,
               cooldown_until = EXCLUDED.cooldown_until,
               reasons = EXCLUDED.reasons,
               metrics_snapshot = EXCLUDED.metrics_snapshot,
               updated_at = CURRENT_TIMESTAMP`,
            [
              clientId,
              currentDomainId,
              currentProvider,
              persistence.state,
              persistence.maxPerHour,
              persistence.maxPerMinute,
              persistence.maxConcurrency,
              persistence.cooldownUntil,
              JSON.stringify(persistence.reasons),
              JSON.stringify(persistence.metricsSnapshot),
            ]
          )

          const message = overrideMessage({
            action,
            provider: currentProvider,
            domain: domainRow.domain,
            bulk,
          })

          await exec(
            `INSERT INTO reputation_events (
               client_id,
               domain_id,
               provider,
               event_type,
               severity,
               message,
               previous_state,
               next_state,
               metrics_snapshot
             )
             VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb)`,
            [
              clientId,
              currentDomainId,
              currentProvider,
              action === 'pause' ? 'pause' : 'resume',
              action === 'pause' ? 'critical' : 'info',
              message,
              JSON.stringify(previousRes.rows[0] ?? null),
              JSON.stringify({
                state: persistence.state,
                max_per_hour: persistence.maxPerHour,
                max_per_minute: persistence.maxPerMinute,
                max_concurrency: persistence.maxConcurrency,
                reasons: persistence.reasons,
              }),
              JSON.stringify(persistence.metricsSnapshot),
            ]
          )

          lanes.push({
            domainId: currentDomainId,
            domain: domainRow.domain,
            provider: currentProvider,
            signal,
            message,
          })
        }
      }

      return { notFound: false as const, lanes }
    })

    if (result.notFound) {
      return NextResponse.json({ ok: false, error: 'Domain not found' }, { status: 404 })
    }

    const redisClient = getRedis()
    const ttlSeconds = action === 'pause' ? 60 * 60 : 60 * 10
    for (const lane of result.lanes) {
      const laneKey = `xv:${REGION}:adaptive:lane:${clientId}:${lane.domainId}:${lane.provider}`
      const pauseKey = `xv:${REGION}:adaptive:lane_pause:${clientId}:${lane.domainId}:${lane.provider}`
      await redisClient.set(laneKey, JSON.stringify(lane.signal), 'EX', ttlSeconds)
      if (action === 'pause') {
        await redisClient.set(pauseKey, JSON.stringify(lane.signal), 'EX', ttlSeconds)
      } else {
        await redisClient.del(pauseKey)
      }
    }

    return NextResponse.json({
      ok: true,
      clientId,
      domainId,
      provider: provider ?? 'all',
      action,
      affectedLanes: result.lanes.length,
      messages: result.lanes.map((lane) => lane.message),
      redis: { synced: true, region: REGION },
    })
  } catch (error) {
    console.error('[api/reputation/override] failed', error)
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 })
  }
}
