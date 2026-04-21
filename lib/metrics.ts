import { query } from '@/lib/db'
import { getQueueLength } from '@/lib/redis'

export interface SystemMetricsSnapshot {
  client_id: number
  window_minutes: number
  sends: number
  replies: number
  opens: number
  bounces: number
  failures: number
  queue_depth: number
  reply_rate: number
  open_rate: number
  bounce_rate: number
}

function safeRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.max(0, Math.min(1, numerator / denominator))
}

export async function readSystemMetrics(clientId: number, windowMinutes = 60): Promise<SystemMetricsSnapshot> {
  const window = Math.max(5, Math.min(1440, windowMinutes))
  const since = `${window} minutes`

  const [counts, queueDepth] = await Promise.all([
    query<{
      sends: string
      replies: string
      opens: string
      bounces: string
      failures: string
    }>(
      `
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'sent')::text AS sends,
        COUNT(*) FILTER (WHERE event_type = 'reply')::text AS replies,
        COUNT(*) FILTER (WHERE event_type IN ('open', 'opened'))::text AS opens,
        COUNT(*) FILTER (WHERE event_type = 'bounce')::text AS bounces,
        COUNT(*) FILTER (WHERE event_type IN ('failed', 'error'))::text AS failures
      FROM events
      WHERE client_id = $1
        AND created_at > NOW() - ($2::text)::interval
      `,
      [clientId, since]
    ),
    getQueueLength(),
  ])

  const row = counts.rows[0]
  const sends = Number(row?.sends ?? 0) || 0
  const replies = Number(row?.replies ?? 0) || 0
  const opens = Number(row?.opens ?? 0) || 0
  const bounces = Number(row?.bounces ?? 0) || 0
  const failures = Number(row?.failures ?? 0) || 0

  return {
    client_id: clientId,
    window_minutes: window,
    sends,
    replies,
    opens,
    bounces,
    failures,
    queue_depth: queueDepth,
    reply_rate: safeRate(replies, Math.max(1, sends)),
    open_rate: safeRate(opens, Math.max(1, sends)),
    bounce_rate: safeRate(bounces, Math.max(1, sends)),
  }
}

