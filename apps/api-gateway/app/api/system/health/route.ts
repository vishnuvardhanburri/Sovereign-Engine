import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { appEnv } from '@/lib/env'
import { resolveClientId } from '@/lib/client-context'

function rate(numerator: number, denominator: number) {
  if (!denominator) return 0
  return numerator / denominator
}

export async function GET(request: NextRequest) {
  try {
    const clientId = await resolveClientId({ headers: request.headers })
    const now = new Date()

    const [sent1m, sent1h, events24h, events7d, queueLag, domains, latestMetrics] = await Promise.all([
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM events
         WHERE client_id = $1 AND event_type = 'sent'
           AND created_at > (CURRENT_TIMESTAMP - INTERVAL '1 minute')`,
        [clientId]
      ),
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM events
         WHERE client_id = $1 AND event_type = 'sent'
           AND created_at > (CURRENT_TIMESTAMP - INTERVAL '1 hour')`,
        [clientId]
      ),
      query<{ sent: string; bounce: string; reply: string }>(
        `SELECT
           COUNT(*) FILTER (WHERE event_type = 'sent')::text AS sent,
           COUNT(*) FILTER (WHERE event_type = 'bounce')::text AS bounce,
           COUNT(*) FILTER (WHERE event_type = 'reply')::text AS reply
         FROM events
         WHERE client_id = $1
           AND created_at > (CURRENT_TIMESTAMP - INTERVAL '24 hours')`,
        [clientId]
      ),
      query<{ sent: string; bounce: string; reply: string }>(
        `SELECT
           COUNT(*) FILTER (WHERE event_type = 'sent')::text AS sent,
           COUNT(*) FILTER (WHERE event_type = 'bounce')::text AS bounce,
           COUNT(*) FILTER (WHERE event_type = 'reply')::text AS reply
         FROM events
         WHERE client_id = $1
           AND created_at > (CURRENT_TIMESTAMP - INTERVAL '7 days')`,
        [clientId]
      ),
      query<{ scheduled_at: string | null }>(
        `SELECT MIN(scheduled_at) AS scheduled_at
         FROM queue_jobs
         WHERE client_id = $1 AND status IN ('pending','retry')`,
        [clientId]
      ),
      query<{ total: string; paused: string; avg_health: string }>(
        `SELECT
           COUNT(*)::text AS total,
           COUNT(*) FILTER (WHERE status != 'active')::text AS paused,
           COALESCE(AVG(health_score), 0)::text AS avg_health
         FROM domains
         WHERE client_id = $1`,
        [clientId]
      ),
      query<{ metric_name: string; metric_value: number; created_at: string }>(
        `SELECT metric_name, metric_value, created_at
         FROM system_metrics
         WHERE client_id = $1
           AND metric_name IN (
             'duplicate_send_prevented',
             'idempotency_hits',
             'inflight_conflicts',
             'retry_count',
             'outcome_drift_detected'
           )
         ORDER BY created_at DESC
         LIMIT 200`,
        [clientId]
      ),
    ])

    const e24 = events24h.rows[0] ?? { sent: '0', bounce: '0', reply: '0' }
    const e7 = events7d.rows[0] ?? { sent: '0', bounce: '0', reply: '0' }

    const sent24 = Number(e24.sent ?? 0)
    const bounce24 = Number(e24.bounce ?? 0)
    const reply24 = Number(e24.reply ?? 0)
    const sent7 = Number(e7.sent ?? 0)
    const bounce7 = Number(e7.bounce ?? 0)
    const reply7 = Number(e7.reply ?? 0)

    const lagAt = queueLag.rows[0]?.scheduled_at ? new Date(queueLag.rows[0].scheduled_at) : null
    const queueLagMs = lagAt ? Math.max(0, lagAt.getTime() - now.getTime()) : 0

    return NextResponse.json({
      ok: true,
      clientId,
      time: now.toISOString(),
      baseUrl: appEnv.baseUrl(),
      rates: {
        send_rate_per_min: Number(sent1m.rows[0]?.count ?? 0),
        send_rate_per_hour: Number(sent1h.rows[0]?.count ?? 0),
        bounce_rate_24h: Number(rate(bounce24, sent24).toFixed(4)),
        reply_rate_24h: Number(rate(reply24, sent24).toFixed(4)),
        bounce_rate_7d: Number(rate(bounce7, sent7).toFixed(4)),
        reply_rate_7d: Number(rate(reply7, sent7).toFixed(4)),
      },
      queue: {
        queue_lag_ms: queueLagMs,
        oldest_scheduled_at: lagAt?.toISOString() ?? null,
      },
      domains: {
        total: Number(domains.rows[0]?.total ?? 0),
        paused: Number(domains.rows[0]?.paused ?? 0),
        avg_health_score: Number(Number(domains.rows[0]?.avg_health ?? 0).toFixed(2)),
      },
      metrics: latestMetrics.rows,
    })
  } catch (error) {
    console.error('[api/system/health] failed', error)
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 })
  }
}

