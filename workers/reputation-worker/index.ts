import 'dotenv/config'
import IORedis from 'ioredis'
import { Pool } from 'pg'
import { computeAdaptiveThroughput, loadDomainSignals, type AdaptiveState, type ProviderSignals } from '@xavira/adaptive-controller'
import { detectProvider } from '@xavira/provider-engine'

function reqEnv(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

const REGION = process.env.XV_REGION ?? 'local'
const INTERVAL_MS = Number(process.env.REPUTATION_TICK_MS ?? 30_000)
const pool = new Pool({ connectionString: reqEnv('DATABASE_URL') })
const redis = new IORedis(reqEnv('REDIS_URL'))

type DbExecutor = <T = any>(text: string, params?: any[]) => Promise<{ rows: T[]; rowCount: number }>
const db: DbExecutor = async (text, params = []) => {
  const client = await pool.connect()
  try {
    const res = await client.query(text, params)
    return { rows: res.rows as any, rowCount: res.rowCount }
  } finally {
    client.release()
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function providerList(): Array<'gmail' | 'outlook' | 'yahoo' | 'other'> {
  return ['gmail', 'outlook', 'yahoo', 'other']
}

async function computeProviderLaneSignals(clientId: number, domainId: number) {
  // Uses existing events table and smtp_class tagging emitted by sender-worker.
  // This is intentionally conservative and measurement-only.
  const res = await db<{
    provider: string
    attempts_1h: string
    deferrals_1h: string
    blocks_1h: string
    successes_1h: string
  }>(
    `WITH base AS (
       SELECT
         COALESCE(metadata->>'provider','other') AS provider,
         event_type,
         created_at,
         COALESCE(metadata->>'smtp_class','') AS smtp_class
       FROM events
       WHERE client_id = $1 AND domain_id = $2
         AND created_at > (CURRENT_TIMESTAMP - INTERVAL '1 hour')
     )
     SELECT
       provider,
       COUNT(*)::text AS attempts_1h,
       COUNT(*) FILTER (WHERE event_type = 'failed' AND smtp_class = 'deferral')::text AS deferrals_1h,
       COUNT(*) FILTER (WHERE event_type = 'failed' AND smtp_class = 'block')::text AS blocks_1h,
       COUNT(*) FILTER (WHERE event_type IN ('sent','delivered'))::text AS successes_1h
     FROM base
     GROUP BY provider`,
    [clientId, domainId]
  )

  const map = new Map<string, { attempts: number; deferrals: number; blocks: number; successes: number }>()
  for (const row of res.rows) {
    map.set(String(row.provider || 'other'), {
      attempts: Number(row.attempts_1h ?? 0),
      deferrals: Number(row.deferrals_1h ?? 0),
      blocks: Number(row.blocks_1h ?? 0),
      successes: Number(row.successes_1h ?? 0),
    })
  }
  return map
}

async function tickOnce() {
  const clients = await db<{ id: number }>(`SELECT id FROM clients ORDER BY id ASC`)
  for (const c of clients.rows) {
    const clientId = Number(c.id)

    const domains = await db<{ id: number; domain: string; status: string }>(
      `SELECT id, domain, status FROM domains WHERE client_id = $1 ORDER BY id ASC`,
      [clientId]
    )

    for (const d of domains.rows) {
      const domainId = Number(d.id)
      const domainSignals = await loadDomainSignals(db as any, clientId, domainId)
      if (!domainSignals) continue

      const providerSignalsByLane = await computeProviderLaneSignals(clientId, domainId)

      for (const p of providerList()) {
        const laneSignals = providerSignalsByLane.get(p) ?? { attempts: 0, deferrals: 0, blocks: 0, successes: 0 }
        const attempts = laneSignals.attempts
        const deferralRate = attempts > 0 ? laneSignals.deferrals / attempts : 0
        const blockRate = attempts > 0 ? laneSignals.blocks / attempts : 0
        const successRate = attempts > 0 ? laneSignals.successes / attempts : 1

        // Convert to a conservative providerRisk used by sender-worker.
        const risk = clamp(deferralRate * 0.6 + blockRate * 1.2 + (1 - successRate) * 0.5, 0, 1)
        const providerKey = `xv:${REGION}:adaptive:provider_risk:${clientId}:${p}`
        // Store 0..0.5 to match sender-worker clamp.
        await redis.set(providerKey, String(clamp(risk, 0, 0.5)), 'EX', 60 * 10)

        // Snapshot for audit/visibility.
        const throttleFactor = clamp(1 - clamp(risk, 0, 0.5), 0.5, 1)
        await db(
          `INSERT INTO provider_health_snapshots (client_id, provider, deferral_rate, block_rate, success_rate, throttle_factor)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [clientId, p, deferralRate, blockRate, successRate, throttleFactor]
        ).catch(() => {})

        // Durable reputation state per domain/provider (used for recovery + UI).
        const providerSignals: ProviderSignals = { provider: p, providerRisk: risk, timeWindowHour: new Date().getUTCHours() }
        const stateKey = `xv:${REGION}:adaptive:state:${clientId}:${domainId}:${p}`
        const prevRaw = await redis.get(stateKey)
        const prev: AdaptiveState | undefined = prevRaw ? (JSON.parse(prevRaw) as any) : undefined
        const { throughput, nextState } = computeAdaptiveThroughput(domainSignals, providerSignals, prev, Date.now())
        await redis.set(stateKey, JSON.stringify(nextState), 'EX', 60 * 60 * 24 * 7)

        const repState =
          throughput.shouldPauseDomain ? 'paused' : throughput.nextWindowAction === 'decrease' ? 'degraded' : 'normal'
        const maxPerMinute = Math.max(2, Math.floor(throughput.maxPerMinute))
        const maxConcurrency = p === 'gmail' || p === 'yahoo' ? 2 : 3

        await db(
          `INSERT INTO reputation_state (client_id, domain_id, provider, state, max_per_minute, max_concurrency, cooldown_until, reasons, metrics_snapshot, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb, now())
           ON CONFLICT (client_id, domain_id, provider)
           DO UPDATE SET
             state = EXCLUDED.state,
             max_per_minute = EXCLUDED.max_per_minute,
             max_concurrency = EXCLUDED.max_concurrency,
             cooldown_until = EXCLUDED.cooldown_until,
             reasons = EXCLUDED.reasons,
             metrics_snapshot = EXCLUDED.metrics_snapshot,
             updated_at = now()`,
          [
            clientId,
            domainId,
            p,
            repState,
            maxPerMinute,
            maxConcurrency,
            throughput.hardStop ? new Date(Date.now() + 60 * 60 * 1000).toISOString() : null,
            JSON.stringify(throughput.reasons ?? []),
            JSON.stringify({ domainSignals, laneSignals, risk, throughput }),
          ]
        )
      }
    }
  }
}

async function main() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const started = Date.now()
    try {
      await tickOnce()
    } catch (err) {
      console.error('[reputation-worker] tick failed', err)
    }
    const elapsed = Date.now() - started
    const sleepMs = Math.max(1_000, INTERVAL_MS - elapsed)
    await new Promise((r) => setTimeout(r, sleepMs))
  }
}

main().catch((e) => {
  console.error('[reputation-worker] fatal', e)
  process.exit(1)
})

