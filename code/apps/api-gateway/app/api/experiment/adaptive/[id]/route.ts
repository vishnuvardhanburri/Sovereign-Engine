import { NextRequest, NextResponse } from 'next/server'
import { appEnv } from '@/lib/env'
import { getSessionCookieName, verifySessionToken } from '@/lib/auth/session'
import { query } from '@/lib/db'

function pct(n: number) {
  return `${(n * 100).toFixed(2)}%`
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const token = request.cookies.get(getSessionCookieName())?.value ?? ''
  const claims = token ? verifySessionToken(appEnv.authSecret(), token) : null
  if (!claims) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const campaignId = Number(id)
  if (!Number.isFinite(campaignId)) {
    return NextResponse.json({ error: 'invalid_campaign_id' }, { status: 400 })
  }

  const clientId = claims.client_id

  const [res, dist] = await Promise.all([
  // Grouping is attached on SENT/FAILED/BOUNCED metadata as `adaptive_experiment`.
  // Replies are mapped via queue_job_id to the group's sent events.
    query<{
    grp: string
    sent: string
    bounces: string
    replies: string
  }>(
    `WITH sent AS (
       SELECT
         queue_job_id,
         COALESCE(metadata->>'adaptive_experiment','unknown') AS grp
       FROM events
       WHERE client_id = $1
         AND campaign_id = $2
         AND event_type = 'sent'
         AND queue_job_id IS NOT NULL
     ),
     bounce AS (
       SELECT DISTINCT queue_job_id
       FROM events
       WHERE client_id = $1
         AND campaign_id = $2
         AND event_type = 'bounce'
         AND queue_job_id IS NOT NULL
     ),
     reply AS (
       SELECT DISTINCT queue_job_id
       FROM events
       WHERE client_id = $1
         AND campaign_id = $2
         AND event_type = 'reply'
         AND queue_job_id IS NOT NULL
     )
     SELECT
       s.grp,
       COUNT(*)::text AS sent,
       COUNT(CASE WHEN b.queue_job_id IS NOT NULL THEN 1 END)::text AS bounces,
       COUNT(CASE WHEN r.queue_job_id IS NOT NULL THEN 1 END)::text AS replies
     FROM sent s
     LEFT JOIN bounce b ON b.queue_job_id = s.queue_job_id
     LEFT JOIN reply r ON r.queue_job_id = s.queue_job_id
     GROUP BY 1`,
    [clientId, campaignId]
    ),
    // Send-time distribution (hour buckets) per group to detect bias.
    query<{ grp: string; hour: number; sent: string }>(
      `SELECT
         COALESCE(metadata->>'adaptive_experiment','unknown') AS grp,
         EXTRACT(HOUR FROM created_at)::int AS hour,
         COUNT(*)::text AS sent
       FROM events
       WHERE client_id = $1
         AND campaign_id = $2
         AND event_type = 'sent'
       GROUP BY 1,2
       ORDER BY 1,2`,
      [clientId, campaignId]
    ),
  ])

  const rowFor = (g: string) => res.rows.find((r) => r.grp === g) ?? { grp: g, sent: '0', bounces: '0', replies: '0' }

  const adaptive = rowFor('adaptive')
  const baseline = rowFor('baseline')

  const aSent = Number(adaptive.sent ?? 0)
  const aReplies = Number(adaptive.replies ?? 0)
  const aBounces = Number(adaptive.bounces ?? 0)
  const bSent = Number(baseline.sent ?? 0)
  const bReplies = Number(baseline.replies ?? 0)
  const bBounces = Number(baseline.bounces ?? 0)

  const aReplyRate = aSent > 0 ? aReplies / aSent : 0
  const bReplyRate = bSent > 0 ? bReplies / bSent : 0
  const aBounceRate = aSent > 0 ? aBounces / aSent : 0
  const bBounceRate = bSent > 0 ? bBounces / bSent : 0

  const replyLift = bReplyRate > 0 ? (aReplyRate - bReplyRate) / bReplyRate : 0
  const bounceReduction = bBounceRate > 0 ? (bBounceRate - aBounceRate) / bBounceRate : 0

  // PART 1 — sample check (within ±10%).
  const totalSent = aSent + bSent
  const expected = totalSent / 2
  const balanced = expected > 0 ? Math.abs(aSent - expected) / expected <= 0.1 : true

  // PART 2 — time distribution similarity check.
  // Compute normalized hour distributions and compare via L1 distance.
  const hours = Array.from({ length: 24 }, (_, i) => i)
  const aByHour = new Map<number, number>()
  const bByHour = new Map<number, number>()
  for (const r of dist.rows) {
    const sent = Number(r.sent ?? 0)
    if (r.grp === 'adaptive') aByHour.set(r.hour, sent)
    if (r.grp === 'baseline') bByHour.set(r.hour, sent)
  }
  const aNorm = hours.map((h) => (aSent > 0 ? (aByHour.get(h) ?? 0) / aSent : 0))
  const bNorm = hours.map((h) => (bSent > 0 ? (bByHour.get(h) ?? 0) / bSent : 0))
  const l1 = hours.reduce((acc, _, i) => acc + Math.abs(aNorm[i] - bNorm[i]), 0)
  const timeDistributionOk = l1 <= 0.4 // heuristic: >0.4 implies materially different timing

  // PART 5 — confidence/maturity thresholds.
  const repliesTotal = aReplies + bReplies
  const mature = aSent >= 40 && bSent >= 40 && repliesTotal >= 5

  let status: 'valid' | 'insufficient_data' | 'invalid' = 'valid'
  const invalidReasons: string[] = []
  if (!mature) status = 'insufficient_data'
  if (!balanced) {
    status = 'invalid'
    invalidReasons.push('unbalanced_groups')
  }
  if (!timeDistributionOk) {
    status = 'invalid'
    invalidReasons.push('send_time_distribution_skew')
  }

  return NextResponse.json({
    campaignId,
    status,
    validity: {
      balanced_groups_within_10pct: balanced,
      time_distribution_l1: Number(l1.toFixed(4)),
      time_distribution_ok: timeDistributionOk,
      maturity: {
        sent_per_group_min: 40,
        replies_total_min: 5,
        actual: { adaptive_sent: aSent, baseline_sent: bSent, replies_total: repliesTotal },
      },
      invalid_reasons: invalidReasons,
    },
    adaptive: {
      sent: aSent,
      replies: aReplies,
      bounces: aBounces,
      reply_rate: Number(clamp(aReplyRate, 0, 1).toFixed(4)),
      bounce_rate: Number(clamp(aBounceRate, 0, 1).toFixed(4)),
    },
    baseline: {
      sent: bSent,
      replies: bReplies,
      bounces: bBounces,
      reply_rate: Number(clamp(bReplyRate, 0, 1).toFixed(4)),
      bounce_rate: Number(clamp(bBounceRate, 0, 1).toFixed(4)),
    },
    delta: {
      reply_rate: status === 'valid' ? pct(replyLift) : null,
      bounce_rate: status === 'valid' ? pct(bounceReduction) : null,
      delta_reply: Number(clamp(aReplyRate - bReplyRate, -1, 1).toFixed(4)),
      delta_bounce: Number(clamp(bBounceRate - aBounceRate, -1, 1).toFixed(4)),
    },
  })
}
