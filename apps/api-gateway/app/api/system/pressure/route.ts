import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { resolveClientId } from '@/lib/client-context'
import IORedis from 'ioredis'

function reqEnv(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

const REGION = process.env.XV_REGION ?? 'local'
const redis = new IORedis(reqEnv('REDIS_URL'))

export async function GET(request: NextRequest) {
  try {
    const clientId = await resolveClientId({ headers: request.headers })

    const [depth, avgWait, sendRate1m] = await Promise.all([
      query<{ ready: string; retry: string }>(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'pending')::text AS ready,
           COUNT(*) FILTER (WHERE status = 'retry')::text AS retry
         FROM queue_jobs
         WHERE client_id = $1`,
        [clientId]
      ),
      query<{ avg_wait_ms: string }>(
        `SELECT
           COALESCE(AVG(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - scheduled_at)) * 1000), 0)::text AS avg_wait_ms
         FROM queue_jobs
         WHERE client_id = $1 AND status IN ('pending','retry')`,
        [clientId]
      ),
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM events
         WHERE client_id = $1 AND event_type = 'sent'
           AND created_at > (CURRENT_TIMESTAMP - INTERVAL '1 minute')`,
        [clientId]
      ),
    ])

    const ready = Number(depth.rows[0]?.ready ?? 0)
    const retry = Number(depth.rows[0]?.retry ?? 0)
    const queueDepth = ready + retry
    const avgWaitMs = Number(avgWait.rows[0]?.avg_wait_ms ?? 0)
    const sendRateCurrent = Number(sendRate1m.rows[0]?.count ?? 0)

    // Throughput headroom is a best-effort SRE signal (used later for autoscaling).
    const globalCap = Number(process.env.GLOBAL_SENDS_PER_MINUTE ?? 120)
    const shaperRatePerSec = Number(process.env.GLOBAL_SHAPER_RATE_PER_SEC ?? 2)
    const shaperBurst = Number(process.env.GLOBAL_SHAPER_BURST ?? 10)
    const maxPossiblePerMin = Math.min(globalCap, Math.floor(shaperRatePerSec * 60 + shaperBurst))
    const throughputHeadroom = Math.max(0, maxPossiblePerMin - sendRateCurrent)

    // Backpressure heuristic: if depth/wait is rising, slow ramp globally (soft -15%).
    const pressureHigh = queueDepth > 500 || avgWaitMs > 5 * 60_000
    if (pressureHigh) {
      await redis.set(`xv:${REGION}:adaptive:pressure_slow:${clientId}`, '0.85', 'EX', 10 * 60)

      // Pressure-aware queueing:
      // - pull up high-priority jobs
      // - defer low-priority jobs
      // This keeps the system moving on high-value sends instead of just slowing everything.
      await query(
        `WITH scored AS (
           SELECT
             q.id,
             COALESCE(dal.priority_score, 0) AS priority_score
           FROM queue_jobs q
           LEFT JOIN decision_audit_logs dal
             ON dal.client_id = q.client_id AND dal.queue_job_id = q.id
           WHERE q.client_id = $1
             AND q.status IN ('pending','retry')
             AND q.scheduled_at < (CURRENT_TIMESTAMP + INTERVAL '2 hours')
         ),
         hi AS (
           SELECT id FROM scored ORDER BY priority_score DESC NULLS LAST LIMIT 100
         ),
         lo AS (
           SELECT id FROM scored ORDER BY priority_score ASC NULLS LAST LIMIT 300
         )
         UPDATE queue_jobs q
         SET scheduled_at = CASE
           WHEN q.id IN (SELECT id FROM hi) THEN LEAST(q.scheduled_at, CURRENT_TIMESTAMP + INTERVAL '2 minutes')
           WHEN q.id IN (SELECT id FROM lo) THEN q.scheduled_at + INTERVAL '15 minutes'
           ELSE q.scheduled_at
         END
         WHERE q.client_id = $1
           AND q.status IN ('pending','retry')`,
        [clientId]
      ).catch(() => {})
    }

    return NextResponse.json({
      ok: true,
      clientId,
      queue: {
        queue_depth: { ready, retry, total: queueDepth },
        avg_wait_time_ms: Math.max(0, Math.floor(avgWaitMs)),
      },
      rates: {
        send_rate_current_per_min: sendRateCurrent,
      },
      shaping: {
        max_possible_per_min: maxPossiblePerMin,
        throughput_headroom: throughputHeadroom,
        pressure_slow_applied: pressureHigh,
        pressure_slow_factor: pressureHigh ? 0.85 : null,
      },
    })
  } catch (error) {
    console.error('[api/system/pressure] failed', error)
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 })
  }
}
