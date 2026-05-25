import { query } from '@/lib/db'

export type OutboundTelegramDigest = {
  sentToday: number
  sent24h: number
  failed24h: number
  bounced24h: number
  replies24h: number
  replyRate24h: number
  sent7d: number
  replies7d: number
  replyRate7d: number
  followUpsDue: number
  followUpsPending: number
  followUpsSent24h: number
  followUpsStopped24h: number
  queuedNow: number
  /** Most frequent failure error string in the last 24h, or null if no failures */
  topFailureReason: string | null
  /** Heuristic next-action recommendation based on current system state */
  nextAction: string
  lastEvents: Array<{
    type: 'sent' | 'failed' | 'bounced' | 'reply'
    email: string
    subject: string
    reason?: string
    ts: string
  }>
}

function safeInt(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

function replyRate(sent: number, replies: number): number {
  if (sent <= 0) return 0
  return Math.round((replies / sent) * 1000) / 10
}

export async function getOutboundTelegramDigest(clientId: number): Promise<OutboundTelegramDigest> {
  try {
    const [eventsRes, followUpsRes, queueRes] = await Promise.all([
      // Delivery events: sent / failed / bounce + reply signals from events table
      query<{
        event_type: string
        bucket: string
        cnt: string
      }>(
        `SELECT
           event_type,
           CASE
             WHEN created_at >= NOW() - INTERVAL '24 hours' AND DATE(created_at AT TIME ZONE 'UTC') = CURRENT_DATE AT TIME ZONE 'UTC' THEN 'today_and_24h'
             WHEN created_at >= NOW() - INTERVAL '24 hours' THEN 'h24'
             WHEN created_at >= NOW() - INTERVAL '7 days' THEN 'd7'
             ELSE 'older'
           END AS bucket,
           COUNT(*) AS cnt
         FROM events
         WHERE client_id = $1
           AND event_type IN ('sent','failed','bounce','reply','bounced')
           AND (
             event_type <> 'reply'
             OR contact_id IS NOT NULL
             OR queue_job_id IS NOT NULL
             OR campaign_id IS NOT NULL
           )
           AND created_at >= NOW() - INTERVAL '7 days'
         GROUP BY 1, 2`,
        [clientId]
      ),

      // Follow-up tracking from queue_jobs
      query<{
        status: string
        is_followup: string
        updated_today: string
        cnt: string
      }>(
        `SELECT
           status,
           CASE WHEN COALESCE(metadata->>'step_number','0')::int > 1 THEN 'true' ELSE 'false' END AS is_followup,
           CASE WHEN updated_at >= NOW() - INTERVAL '24 hours' THEN 'true' ELSE 'false' END AS updated_today,
           COUNT(*) AS cnt
         FROM queue_jobs
         WHERE client_id = $1
           AND created_at >= NOW() - INTERVAL '30 days'
         GROUP BY 1, 2, 3`,
        [clientId]
      ).catch(() => ({ rows: [] as {status:string;is_followup:string;updated_today:string;cnt:string}[], rowCount: 0 })),

      // Current queue depth (pending jobs)
      query<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt
         FROM queue_jobs
         WHERE client_id = $1
           AND status IN ('pending','waiting','delayed')`,
        [clientId]
      ).catch(() => ({ rows: [{ cnt: '0' }], rowCount: 1 })),
    ])

    // Aggregate event counts
    let sentToday = 0
    let sent24h = 0
    let failed24h = 0
    let bounced24h = 0
    let replies24h = 0
    let sent7d = 0
    let replies7d = 0

    for (const row of eventsRes.rows) {
      const cnt = safeInt(row.cnt)
      const type = row.event_type
      const bucket = row.bucket

      const isSent = type === 'sent'
      const isFailed = type === 'failed'
      const isBounce = type === 'bounce' || type === 'bounced'
      const isReply = type === 'reply'

      if (bucket === 'today_and_24h') {
        if (isSent) { sentToday += cnt; sent24h += cnt }
        if (isFailed) failed24h += cnt
        if (isBounce) bounced24h += cnt
        if (isReply) replies24h += cnt
      } else if (bucket === 'h24') {
        if (isSent) sent24h += cnt
        if (isFailed) failed24h += cnt
        if (isBounce) bounced24h += cnt
        if (isReply) replies24h += cnt
      }

      // 7d totals include today_and_24h and h24 and d7
      if (bucket !== 'older') {
        if (isSent) sent7d += cnt
        if (isReply) replies7d += cnt
      }
    }

    // Follow-up aggregation
    let followUpsDue = 0
    let followUpsPending = 0
    let followUpsSent24h = 0
    let followUpsStopped24h = 0

    for (const row of followUpsRes.rows) {
      if (row.is_followup !== 'true') continue
      const cnt = safeInt(row.cnt)
      const status = row.status
      const recentlyUpdated = row.updated_today === 'true'

      if (status === 'pending' || status === 'waiting' || status === 'delayed') {
        followUpsPending += cnt
        // due = pending follow-ups whose scheduled time has passed (approximate via status)
        if (status === 'waiting') followUpsDue += cnt
      }
      if (status === 'completed' && recentlyUpdated) followUpsSent24h += cnt
      if ((status === 'stopped' || status === 'cancelled') && recentlyUpdated) followUpsStopped24h += cnt
    }

    const queuedNow = safeInt(queueRes.rows[0]?.cnt)

    // Top failure reason in last 24h
    const topFailureRes = await query<{ error: string; cnt: string }>(
      `SELECT
         COALESCE(NULLIF(TRIM(metadata->>'error'),''), NULLIF(TRIM(metadata->>'reason'),''), 'unknown') AS error,
         COUNT(*) AS cnt
       FROM events
       WHERE client_id = $1
         AND event_type IN ('failed','bounce','bounced')
         AND created_at >= NOW() - INTERVAL '24 hours'
         AND COALESCE(NULLIF(TRIM(metadata->>'error'),''), NULLIF(TRIM(metadata->>'reason'),'')) IS NOT NULL
       GROUP BY 1
       ORDER BY cnt DESC
       LIMIT 1`,
      [clientId]
    ).catch(() => ({ rows: [] as { error: string; cnt: string }[], rowCount: 0 }))

    const topFailureReason = topFailureRes.rows[0]?.error ?? null

    // Heuristic next-action
    function deriveNextAction(): string {
      if (failed24h > sent24h * 0.1 && sent24h > 0) {
        return `High failure rate (${failed24h}/${sent24h}). Check SMTP credentials and domain health first.`
      }
      if (bounced24h > 2) {
        return `${bounced24h} bounces detected. Run ZeroBounce validation on queued contacts before next send.`
      }
      if (replies24h > 0 && followUpsStopped24h < replies24h) {
        return `${replies24h} replies — verify follow-ups are stopped for replied contacts.`
      }
      if (queuedNow === 0 && sentToday === 0) {
        return 'Nothing queued or sent today. Check DAILY_OUTBOUND_ENABLED and domain capacity.'
      }
      if (queuedNow > 0 && sentToday === 0) {
        return `${queuedNow} jobs queued but 0 sent. Check sender worker is running on Render.`
      }
      if (followUpsDue > 0) {
        return `${followUpsDue} follow-ups are due. Ensure sequence worker is processing them.`
      }
      if (sentToday > 0 && replies24h === 0) {
        return `Sending healthy (${sentToday} today). Keep monitoring for first replies — refine copy if none in 48h.`
      }
      return 'System nominal. Continue monitoring response rate and domain health.'
    }

    const nextAction = deriveNextAction()

    // Last 8 events for the digest feed
    const lastEventsRes = await query<{
      event_type: string
      created_at: string
      to_email: string | null
      subject: string | null
      error: string | null
    }>(
      `SELECT
         e.event_type,
         e.created_at::text,
         CASE
           WHEN e.event_type = 'reply' THEN COALESCE(NULLIF(e.metadata->>'from_email',''), co.email)
           ELSE COALESCE(NULLIF(e.metadata->>'to_email',''), NULLIF(e.metadata->>'to',''), co.email)
         END AS to_email,
         COALESCE(NULLIF(e.metadata->>'subject',''), NULLIF(e.metadata->>'email_subject','')) AS subject,
         CASE
           WHEN e.event_type = 'reply' THEN NULLIF(e.metadata->>'body','')
           ELSE COALESCE(NULLIF(e.metadata->>'error',''), NULLIF(e.metadata->>'reason',''))
         END AS error
       FROM events e
       LEFT JOIN contacts co ON co.id = e.contact_id AND co.client_id = e.client_id
       WHERE e.client_id = $1
         AND (
           e.event_type IN ('sent','failed','bounce','bounced')
           OR (
             e.event_type = 'reply'
             AND (e.contact_id IS NOT NULL OR e.queue_job_id IS NOT NULL OR e.campaign_id IS NOT NULL)
           )
         )
       ORDER BY e.created_at DESC
       LIMIT 8`,
      [clientId]
    )

    const lastEvents = lastEventsRes.rows.map((r) => ({
      type: (r.event_type === 'bounce' || r.event_type === 'bounced' ? 'bounced' : r.event_type) as 'sent' | 'failed' | 'bounced' | 'reply',
      email: r.to_email ?? '',
      subject: (r.subject ?? '').slice(0, 80),
      reason: r.error ?? undefined,
      ts: r.created_at,
    }))

    return {
      sentToday,
      sent24h,
      failed24h,
      bounced24h,
      replies24h,
      replyRate24h: replyRate(sent24h, replies24h),
      sent7d,
      replies7d,
      replyRate7d: replyRate(sent7d, replies7d),
      followUpsDue,
      followUpsPending,
      followUpsSent24h,
      followUpsStopped24h,
      queuedNow,
      topFailureReason,
      nextAction,
      lastEvents,
    }
  } catch (error) {
    console.error('[outbound-telegram-digest] failed', error)
    // Return zeroed digest so Telegram still fires
    return {
      sentToday: 0,
      sent24h: 0,
      failed24h: 0,
      bounced24h: 0,
      replies24h: 0,
      replyRate24h: 0,
      sent7d: 0,
      replies7d: 0,
      replyRate7d: 0,
      followUpsDue: 0,
      followUpsPending: 0,
      followUpsSent24h: 0,
      followUpsStopped24h: 0,
      queuedNow: 0,
      topFailureReason: null,
      nextAction: 'Digest query failed — check DB connectivity.',
      lastEvents: [],
    }
  }
}
