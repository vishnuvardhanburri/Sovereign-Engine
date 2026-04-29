import { NextRequest, NextResponse } from 'next/server'
import IORedis from 'ioredis'
import { resolveClientId } from '@/lib/client-context'
import { transaction } from '@/lib/db'

type Provider = 'gmail' | 'outlook' | 'yahoo' | 'other'
type OverrideAction = 'pause' | 'resume'

const REGION = process.env.XV_REGION ?? 'local'

let redis: IORedis | null = null

function getRedis() {
  const url = process.env.REDIS_URL
  if (!url) throw new Error('Missing required env var: REDIS_URL')
  if (!redis) redis = new IORedis(url, { maxRetriesPerRequest: 2 })
  return redis
}

function normalizeProvider(value: unknown): Provider | null {
  const raw = String(value ?? '').trim().toLowerCase()
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const clientId = await resolveClientId({ body, headers: request.headers })
    const domainId = Number(body.domain_id ?? body.domainId)
    const provider = normalizeProvider(body.provider)
    const action = normalizeAction(body.action)

    if (!Number.isFinite(domainId) || domainId <= 0) {
      return NextResponse.json({ ok: false, error: 'domain_id is required' }, { status: 400 })
    }
    if (!provider) {
      return NextResponse.json({ ok: false, error: 'provider must be gmail, outlook, yahoo, or other' }, { status: 400 })
    }
    if (!action) {
      return NextResponse.json({ ok: false, error: 'action must be pause or resume' }, { status: 400 })
    }

    const result = await transaction(async (exec) => {
      const domainRes = await exec<{ domain: string }>(
        `SELECT domain
         FROM domains
         WHERE client_id = $1 AND id = $2
         LIMIT 1`,
        [clientId, domainId]
      )
      const domain = domainRes.rows[0]?.domain
      if (!domain) {
        return { notFound: true as const }
      }

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
        [clientId, domainId, provider]
      )

      const { signal, persistence } = buildSignal({ clientId, domainId, provider, action, domain })

      const upsertRes = await exec<{ id: string | number }>(
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
           updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [
          clientId,
          domainId,
          provider,
          persistence.state,
          persistence.maxPerHour,
          persistence.maxPerMinute,
          persistence.maxConcurrency,
          persistence.cooldownUntil,
          JSON.stringify(persistence.reasons),
          JSON.stringify(persistence.metricsSnapshot),
        ]
      )

      const eventType = action === 'pause' ? 'pause' : 'resume'
      const severity = action === 'pause' ? 'critical' : 'info'
      const message =
        action === 'pause'
          ? `Manual override paused ${providerLabel(provider)} lane for ${domain}.`
          : `Manual override resumed ${providerLabel(provider)} lane for ${domain} at safe-ramp 50/hr.`

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
          domainId,
          provider,
          eventType,
          severity,
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

      return {
        notFound: false as const,
        domain,
        reputationStateId: upsertRes.rows[0]?.id,
        signal,
        message,
      }
    })

    if (result.notFound) {
      return NextResponse.json({ ok: false, error: 'Domain not found' }, { status: 404 })
    }

    const redisClient = getRedis()
    const laneKey = `xv:${REGION}:adaptive:lane:${clientId}:${domainId}:${provider}`
    const pauseKey = `xv:${REGION}:adaptive:lane_pause:${clientId}:${domainId}:${provider}`
    const ttlSeconds = action === 'pause' ? 60 * 60 : 60 * 10

    await redisClient.set(laneKey, JSON.stringify(result.signal), 'EX', ttlSeconds)
    if (action === 'pause') {
      await redisClient.set(pauseKey, JSON.stringify(result.signal), 'EX', ttlSeconds)
    } else {
      await redisClient.del(pauseKey)
    }

    return NextResponse.json({
      ok: true,
      clientId,
      domainId,
      provider,
      action,
      message: result.message,
      redis: { synced: true, laneKey, pauseKey },
    })
  } catch (error) {
    console.error('[api/reputation/override] failed', error)
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 })
  }
}
