import { NextRequest, NextResponse } from 'next/server'
import { appEnv } from '@/lib/env'
import { getSessionCookieName, verifySessionToken } from '@/lib/auth/session'
import { query } from '@/lib/db'

function pct(n: number) {
  return `${(n * 100).toFixed(2)}%`
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

  // Grouping is attached on SENT/FAILED/BOUNCED metadata as `adaptive_experiment`.
  // Replies are mapped via queue_job_id to the group's sent events.
  const res = await query<{
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
  )

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

  return NextResponse.json({
    campaignId,
    adaptive: {
      sent: aSent,
      replies: aReplies,
      bounces: aBounces,
      reply_rate: aReplyRate,
      bounce_rate: aBounceRate,
    },
    baseline: {
      sent: bSent,
      replies: bReplies,
      bounces: bBounces,
      reply_rate: bReplyRate,
      bounce_rate: bBounceRate,
    },
    delta: {
      reply_rate: pct(replyLift),
      bounce_rate: pct(bounceReduction),
    },
  })
}

