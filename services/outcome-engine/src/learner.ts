import type { DbExecutor } from '@sovereign/types'
import type { SegmentMetrics } from './scorer'

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function safeRate(num: number, den: number) {
  return den > 0 ? clamp(num / den, 0, 1) : 0
}

function decayFactorHours(window: '24h' | '7d'): number {
  // Smaller factor => faster decay. 24h should matter most, older data fades out.
  return window === '24h' ? 18 : 72
}

export async function computeDomainSegmentMetrics(
  deps: { db: DbExecutor },
  input: { clientId: number; domainId: number; window: '24h' | '7d' }
): Promise<SegmentMetrics> {
  const interval = input.window === '24h' ? "24 hours" : "7 days"
  const decay = decayFactorHours(input.window)

  // Aggregate sent/bounce/reply counts.
  const agg = await deps.db<{ sent: string; bounced: string; replied: string; meetings: string }>(
    `SELECT
       COUNT(CASE WHEN event_type='sent' THEN 1 END)::text AS sent,
       COUNT(CASE WHEN event_type='bounce' THEN 1 END)::text AS bounced,
       COUNT(CASE WHEN event_type='reply' THEN 1 END)::text AS replied,
       COUNT(CASE WHEN event_type='meeting_booked' THEN 1 END)::text AS meetings
     FROM events
     WHERE client_id = $1
       AND domain_id = $2
       AND created_at > NOW() - INTERVAL '${interval}'
       AND event_type IN ('sent','bounce','reply','meeting_booked')`,
    [input.clientId, input.domainId]
  )

  const row = agg.rows[0] ?? ({} as any)
  const sent = Number(row.sent ?? 0)
  const bounced = Number(row.bounced ?? 0)
  const replied = Number(row.replied ?? 0)
  const meetings = Number(row.meetings ?? 0)

  // Time-decayed weighted aggregates to reduce sensitivity to old data and noise spikes.
  const weighted = await deps.db<{
    w_sent: string
    w_bounced: string
    w_replied: string
    w_meetings: string
  }>(
    `WITH e AS (
       SELECT
         event_type,
         EXP(- (EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600.0) / $3) AS w
       FROM events
       WHERE client_id = $1
         AND domain_id = $2
         AND created_at > NOW() - INTERVAL '${interval}'
         AND event_type IN ('sent','bounce','reply','meeting_booked')
     )
     SELECT
       COALESCE(SUM(CASE WHEN event_type='sent' THEN w ELSE 0 END), 0)::text AS w_sent,
       COALESCE(SUM(CASE WHEN event_type='bounce' THEN w ELSE 0 END), 0)::text AS w_bounced,
       COALESCE(SUM(CASE WHEN event_type='reply' THEN w ELSE 0 END), 0)::text AS w_replied,
       COALESCE(SUM(CASE WHEN event_type='meeting_booked' THEN w ELSE 0 END), 0)::text AS w_meetings
     FROM e`,
    [input.clientId, input.domainId, decay]
  )
  const w = weighted.rows[0] ?? ({} as any)
  const weighted_sent = Number(w.w_sent ?? 0)
  const weighted_bounced = Number(w.w_bounced ?? 0)
  const weighted_replied = Number(w.w_replied ?? 0)
  const weighted_meetings = Number(w.w_meetings ?? 0)

  // Time-of-day windows: For each sent event hour, compute reply_rate based on matching replies (queue_job_id join).
  const tod = await deps.db<{ hour: number; sent: string; replies: string; bounces: string; w_sent: string; w_replies: string; w_bounces: string }>(
    `WITH sent_events AS (
       SELECT
         queue_job_id,
         EXTRACT(HOUR FROM created_at)::int AS hour,
         EXP(- (EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600.0) / $3) AS w
       FROM events
       WHERE client_id = $1
         AND domain_id = $2
         AND created_at > NOW() - INTERVAL '${interval}'
         AND event_type = 'sent'
         AND queue_job_id IS NOT NULL
     ),
     reply_events AS (
       SELECT DISTINCT queue_job_id
       FROM events
       WHERE client_id = $1
         AND domain_id = $2
         AND created_at > NOW() - INTERVAL '${interval}'
         AND event_type = 'reply'
         AND queue_job_id IS NOT NULL
     ),
     bounce_events AS (
       SELECT DISTINCT queue_job_id
       FROM events
       WHERE client_id = $1
         AND domain_id = $2
         AND created_at > NOW() - INTERVAL '${interval}'
         AND event_type = 'bounce'
         AND queue_job_id IS NOT NULL
     )
     SELECT
       s.hour,
       COUNT(*)::text AS sent,
       COUNT(CASE WHEN r.queue_job_id IS NOT NULL THEN 1 END)::text AS replies,
       COUNT(CASE WHEN b.queue_job_id IS NOT NULL THEN 1 END)::text AS bounces
       ,
       COALESCE(SUM(s.w),0)::text AS w_sent,
       COALESCE(SUM(CASE WHEN r.queue_job_id IS NOT NULL THEN s.w ELSE 0 END),0)::text AS w_replies,
       COALESCE(SUM(CASE WHEN b.queue_job_id IS NOT NULL THEN s.w ELSE 0 END),0)::text AS w_bounces
     FROM sent_events s
     LEFT JOIN reply_events r ON r.queue_job_id = s.queue_job_id
     LEFT JOIN bounce_events b ON b.queue_job_id = s.queue_job_id
     GROUP BY 1
     ORDER BY 1`,
    [input.clientId, input.domainId, decay]
  )

  const windows = tod.rows
    .map((r) => {
      const wSent = Number(r.sent ?? 0)
      const wReplies = Number(r.replies ?? 0)
      const wBounces = Number(r.bounces ?? 0)
      const wSentW = Number((r as any).w_sent ?? 0)
      const wRepliesW = Number((r as any).w_replies ?? 0)
      const wBouncesW = Number((r as any).w_bounces ?? 0)
      // Prefer weighted rates for ranking windows.
      const replyRate = safeRate(wRepliesW, wSentW)
      const bounceRate = safeRate(wBouncesW, wSentW)
      return { hour: Number(r.hour), replyRate, bounceRate, sent: wSent }
    })
    // Ignore very low-sample windows to avoid noise.
    .filter((w) => w.sent >= 20)
    .sort((a, b) => b.replyRate - a.replyRate)

  const best_time_windows = windows.slice(0, 3).map((w) => w.hour)

  const reply_rate = safeRate(replied, sent)
  const bounce_rate = safeRate(bounced, sent)
  const meeting_rate = replied > 0 ? safeRate(meetings, replied) : 0

  const min_samples_ok = sent >= 20
  const replies_mature = replied >= 5

  // Lane recommendation: conservative rule. (Never "increase volume" here.)
  const preferred_lane: SegmentMetrics['preferred_lane'] =
    bounce_rate > 0.08 ? 'slow' : reply_rate < 0.02 ? 'low_risk' : 'normal'

  return {
    window: input.window,
    sent,
    bounced,
    replied,
    meetings,
    weighted_sent,
    weighted_bounced,
    weighted_replied,
    weighted_meetings,
    reply_rate,
    meeting_rate,
    bounce_rate,
    best_time_windows,
    preferred_lane,
    stability: {
      min_samples_ok,
      replies_mature,
      reason: !min_samples_ok ? 'sent_lt_20' : !replies_mature ? 'replies_lt_5' : undefined,
    },
  }
}
