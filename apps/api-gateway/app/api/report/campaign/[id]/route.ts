import { NextRequest, NextResponse } from 'next/server'
import { appEnv } from '@/lib/env'
import { getSessionCookieName, verifySessionToken } from '@/lib/auth/session'
import { query } from '@/lib/db'

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const token = request.cookies.get(getSessionCookieName())?.value ?? ''
  const claims = token ? verifySessionToken(appEnv.authSecret(), token) : null
  if (!claims) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const campaignId = Number(id)
  if (!Number.isFinite(campaignId)) {
    return NextResponse.json({ error: 'invalid_campaign_id' }, { status: 400 })
  }

  const clientId = claims.client_id

  // Aggregate outcomes per experiment group via decision_audit_logs joined to events.
  const rows = await query<{
    outcome_group: string | null
    decisions: string
    sent: string
    replies: string
    bounces: string
    meetings: string
  }>(
    `WITH d AS (
       SELECT *
       FROM decision_audit_logs
       WHERE client_id = $1
         AND campaign_id = $2
         AND created_at > NOW() - INTERVAL '30 days'
     ),
     sent AS (
       SELECT DISTINCT queue_job_id
       FROM events
       WHERE client_id = $1 AND campaign_id = $2 AND event_type = 'sent' AND queue_job_id IS NOT NULL
     ),
     reply AS (
       SELECT DISTINCT queue_job_id
       FROM events
       WHERE client_id = $1 AND campaign_id = $2 AND event_type = 'reply' AND queue_job_id IS NOT NULL
     ),
     bounce AS (
       SELECT DISTINCT queue_job_id
       FROM events
       WHERE client_id = $1 AND campaign_id = $2 AND event_type = 'bounce' AND queue_job_id IS NOT NULL
     ),
     meeting AS (
       SELECT DISTINCT queue_job_id
       FROM events
       WHERE client_id = $1 AND campaign_id = $2 AND event_type = 'meeting_booked' AND queue_job_id IS NOT NULL
     )
     SELECT
       d.outcome_group,
       COUNT(*)::text AS decisions,
       COUNT(CASE WHEN s.queue_job_id IS NOT NULL THEN 1 END)::text AS sent,
       COUNT(CASE WHEN r.queue_job_id IS NOT NULL THEN 1 END)::text AS replies,
       COUNT(CASE WHEN b.queue_job_id IS NOT NULL THEN 1 END)::text AS bounces,
       COUNT(CASE WHEN m.queue_job_id IS NOT NULL THEN 1 END)::text AS meetings
     FROM d
     LEFT JOIN sent s ON s.queue_job_id = d.queue_job_id
     LEFT JOIN reply r ON r.queue_job_id = d.queue_job_id
     LEFT JOIN bounce b ON b.queue_job_id = d.queue_job_id
     LEFT JOIN meeting m ON m.queue_job_id = d.queue_job_id
     GROUP BY 1`,
    [clientId, campaignId]
  )

  const [decisionBreakdown, protection] = await Promise.all([
    query<{ decision: string; count: string }>(
      `SELECT decision, COUNT(*)::text AS count
       FROM decision_audit_logs
       WHERE client_id = $1 AND campaign_id = $2
         AND created_at > NOW() - INTERVAL '30 days'
       GROUP BY 1`,
      [clientId, campaignId]
    ),
    query<{ prevented: string; protection_actions: string }>(
      `WITH prevented AS (
         SELECT COUNT(*)::text AS prevented
         FROM decision_audit_logs
         WHERE client_id = $1 AND campaign_id = $2
           AND created_at > NOW() - INTERVAL '30 days'
           AND (decision IN ('drop','defer') OR (reasons::text ILIKE '%risk%' OR reasons::text ILIKE '%defer%'))
       ),
       protection AS (
         SELECT COUNT(*)::text AS protection_actions
         FROM domain_pause_events
         WHERE client_id = $1
           AND created_at > NOW() - INTERVAL '30 days'
       )
       SELECT (SELECT prevented FROM prevented) AS prevented,
              (SELECT protection_actions FROM protection) AS protection_actions`,
      [clientId, campaignId]
    ),
  ])

  const byGroup = new Map<string, { decisions: number; sent: number; replies: number; bounces: number; meetings: number }>()
  for (const r of rows.rows) {
    const g = (r.outcome_group ?? 'unknown') as string
    byGroup.set(g, {
      decisions: Number(r.decisions ?? 0),
      sent: Number(r.sent ?? 0),
      replies: Number(r.replies ?? 0),
      bounces: Number(r.bounces ?? 0),
      meetings: Number(r.meetings ?? 0),
    })
  }

  const baseline = byGroup.get('baseline') ?? { decisions: 0, sent: 0, replies: 0, bounces: 0, meetings: 0 }
  const treatment = byGroup.get('treatment') ?? { decisions: 0, sent: 0, replies: 0, bounces: 0, meetings: 0 }

  const baseReplyRate = baseline.sent > 0 ? baseline.replies / baseline.sent : 0
  const treatReplyRate = treatment.sent > 0 ? treatment.replies / treatment.sent : 0
  const baseBounceRate = baseline.sent > 0 ? baseline.bounces / baseline.sent : 0
  const treatBounceRate = treatment.sent > 0 ? treatment.bounces / treatment.sent : 0
  const baseMeetingRate = baseline.replies > 0 ? baseline.meetings / baseline.replies : 0
  const treatMeetingRate = treatment.replies > 0 ? treatment.meetings / treatment.replies : 0

  // Experiment maturity thresholds.
  const totalReplies = baseline.replies + treatment.replies
  const mature = baseline.sent >= 200 && treatment.sent >= 200 && totalReplies >= 20

  const costPerSend = appEnv.costPerSend()
  const baseCost = baseline.sent * costPerSend
  const treatCost = treatment.sent * costPerSend
  const baseCostPerReply = baseline.replies > 0 ? baseCost / baseline.replies : null
  const treatCostPerReply = treatment.replies > 0 ? treatCost / treatment.replies : null

  // Best-performing segments (hours + lane) for treatment group only.
  const segments = await query<{ bucket: string; sent: string; replies: string; bounces: string }>(
    `WITH sent AS (
       SELECT
         d.queue_job_id,
         (d.signals->>'best_time_window')::text AS hour_bucket,
         (d.signals->>'preferred_lane')::text AS lane_bucket,
         d.outcome_group
       FROM decision_audit_logs d
       WHERE d.client_id = $1
         AND d.campaign_id = $2
         AND d.outcome_group = 'treatment'
         AND d.created_at > NOW() - INTERVAL '30 days'
     ),
     reply AS (
       SELECT DISTINCT queue_job_id
       FROM events
       WHERE client_id = $1 AND campaign_id = $2 AND event_type = 'reply' AND queue_job_id IS NOT NULL
     ),
     bounce AS (
       SELECT DISTINCT queue_job_id
       FROM events
       WHERE client_id = $1 AND campaign_id = $2 AND event_type = 'bounce' AND queue_job_id IS NOT NULL
     )
     SELECT
       COALESCE('hour:' || COALESCE(hour_bucket,'?'), 'hour:?') AS bucket,
       COUNT(*)::text AS sent,
       COUNT(CASE WHEN r.queue_job_id IS NOT NULL THEN 1 END)::text AS replies,
       COUNT(CASE WHEN b.queue_job_id IS NOT NULL THEN 1 END)::text AS bounces
     FROM sent s
     LEFT JOIN reply r ON r.queue_job_id = s.queue_job_id
     LEFT JOIN bounce b ON b.queue_job_id = s.queue_job_id
     GROUP BY 1
     HAVING COUNT(*) >= 20
     ORDER BY (COUNT(CASE WHEN r.queue_job_id IS NOT NULL THEN 1 END)::float / COUNT(*)::float) DESC
     LIMIT 5`,
    [clientId, campaignId]
  )

  const segmentSummary = segments.rows.map((r) => {
    const sent = Number(r.sent ?? 0)
    const replies = Number(r.replies ?? 0)
    const bounces = Number(r.bounces ?? 0)
    return {
      segment: r.bucket,
      sent,
      replies,
      bounces,
      reply_rate: sent > 0 ? clamp(replies / sent, 0, 1) : 0,
      bounce_rate: sent > 0 ? clamp(bounces / sent, 0, 1) : 0,
    }
  })

  const replyLiftPct = baseReplyRate > 0 ? ((treatReplyRate - baseReplyRate) / baseReplyRate) * 100 : null
  const bounceReductionPct = baseBounceRate > 0 ? ((baseBounceRate - treatBounceRate) / baseBounceRate) * 100 : null

  return NextResponse.json({
    campaignId,
    maturity: {
      mature,
      required: { sends_per_group: 200, replies_total: 20 },
      actual: { baseline_sent: baseline.sent, treatment_sent: treatment.sent, replies_total: totalReplies },
      status: mature ? 'mature' : 'insufficient_data',
    },
    baseline: {
      ...baseline,
      reply_rate: clamp(baseReplyRate, 0, 1),
      bounce_rate: clamp(baseBounceRate, 0, 1),
      meeting_rate: clamp(baseMeetingRate, 0, 1),
      cost_per_reply: baseCostPerReply,
      efficiency_score: baseline.sent > 0 ? clamp(baseline.replies / baseline.sent, 0, 1) : 0,
      sends_per_reply: baseline.replies > 0 ? baseline.sent / baseline.replies : null,
    },
    treatment: {
      ...treatment,
      reply_rate: clamp(treatReplyRate, 0, 1),
      bounce_rate: clamp(treatBounceRate, 0, 1),
      meeting_rate: clamp(treatMeetingRate, 0, 1),
      cost_per_reply: treatCostPerReply,
      efficiency_score: treatment.sent > 0 ? clamp(treatment.replies / treatment.sent, 0, 1) : 0,
      sends_per_reply: treatment.replies > 0 ? treatment.sent / treatment.replies : null,
    },
    deltas: {
      reply_lift_pct: replyLiftPct,
      bounce_reduction_pct: bounceReductionPct,
      reply_rate_delta: clamp(treatReplyRate - baseReplyRate, -1, 1),
      bounce_rate_delta: clamp(treatBounceRate - baseBounceRate, -1, 1),
    },
    best_segments: segmentSummary,
    trust_metrics: {
      emails_prevented_risk: Number(protection.rows[0]?.prevented ?? 0),
      domain_protection_actions: Number(protection.rows[0]?.protection_actions ?? 0),
      adaptive_decisions_breakdown: Object.fromEntries(
        decisionBreakdown.rows.map((r) => [r.decision, Number(r.count ?? 0)])
      ),
    },
    safe_mode: appEnv.safeModeEnabled(),
  })
}
