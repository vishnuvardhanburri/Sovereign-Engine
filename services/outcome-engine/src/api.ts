import type { DbExecutor } from '@xavira/types'
import { computeDomainSegmentMetrics } from './learner'
import { scoreSignals } from './scorer'

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

export async function getOutcomeSignals(deps: { db: DbExecutor }, context: { clientId: number; domainId: number }) {
  const [metrics24h, metrics7d] = await Promise.all([
    computeDomainSegmentMetrics(deps, { clientId: context.clientId, domainId: context.domainId, window: '24h' }),
    computeDomainSegmentMetrics(deps, { clientId: context.clientId, domainId: context.domainId, window: '7d' }),
  ])

  // Controlled learning: only trust lane switches when both windows agree.
  const agreeLane = metrics24h.preferred_lane === metrics7d.preferred_lane
  const baseSignals = scoreSignals(metrics7d)
  const fastSignals = scoreSignals(metrics24h)

  const available = Boolean(baseSignals.available && metrics7d.stability.min_samples_ok)
  const expected_reply_prob = clamp(
    fastSignals.expected_reply_prob * 0.7 + baseSignals.expected_reply_prob * 0.3,
    0,
    0.25
  )
  // Noise guardrail: cap extreme values. scoreSignals already caps, we take the safer max.
  const risk_adjustment = clamp(Math.max(fastSignals.risk_adjustment, baseSignals.risk_adjustment), 0, 0.1)
  const preferred_lane = agreeLane ? metrics7d.preferred_lane : undefined
  const reasons = [
    ...new Set([
      ...(baseSignals.reasons ?? []),
      ...(fastSignals.reasons ?? []),
      ...(agreeLane ? ['lane_consensus'] : ['lane_conflict_fallback']),
    ]),
  ]

  return {
    available,
    expected_reply_prob,
    risk_adjustment,
    best_time_window: baseSignals.best_time_window ?? fastSignals.best_time_window,
    preferred_lane,
    reasons,
    window: 'blended',
    metrics: { last24h: metrics24h, last7d: metrics7d },
  }
}

export async function getOutcomeDomain(deps: { db: DbExecutor }, input: { clientId: number; domainId: number }) {
  const metrics24h = await computeDomainSegmentMetrics(deps, { clientId: input.clientId, domainId: input.domainId, window: '24h' })
  const metrics7d = await computeDomainSegmentMetrics(deps, { clientId: input.clientId, domainId: input.domainId, window: '7d' })

  // Lane performance: infer lane from queue_jobs metadata for sent events.
  const lanePerf = await deps.db<{ lane: string; sent: string; replies: string; bounces: string }>(
    `WITH sent_jobs AS (
       SELECT
         e.queue_job_id,
         COALESCE(qj.metadata->'delivery'->>'override_lane', qj.metadata->'advanced_trace'->'decision'->>'lane', 'normal') AS lane
       FROM events e
       JOIN queue_jobs qj ON qj.client_id = e.client_id AND qj.id = e.queue_job_id
       WHERE e.client_id = $1
         AND e.domain_id = $2
         AND e.created_at > NOW() - INTERVAL '7 days'
         AND e.event_type = 'sent'
         AND e.queue_job_id IS NOT NULL
     ),
     reply_jobs AS (
       SELECT DISTINCT queue_job_id FROM events
       WHERE client_id = $1 AND domain_id = $2 AND created_at > NOW() - INTERVAL '7 days' AND event_type = 'reply' AND queue_job_id IS NOT NULL
     ),
     bounce_jobs AS (
       SELECT DISTINCT queue_job_id FROM events
       WHERE client_id = $1 AND domain_id = $2 AND created_at > NOW() - INTERVAL '7 days' AND event_type = 'bounce' AND queue_job_id IS NOT NULL
     )
     SELECT
       s.lane,
       COUNT(*)::text AS sent,
       COUNT(CASE WHEN r.queue_job_id IS NOT NULL THEN 1 END)::text AS replies,
       COUNT(CASE WHEN b.queue_job_id IS NOT NULL THEN 1 END)::text AS bounces
     FROM sent_jobs s
     LEFT JOIN reply_jobs r ON r.queue_job_id = s.queue_job_id
     LEFT JOIN bounce_jobs b ON b.queue_job_id = s.queue_job_id
     GROUP BY 1
     ORDER BY 1`,
    [input.clientId, input.domainId]
  )

  // Domain contribution to replies: domain replies / total replies over last 7d.
  const [domainRepliesRes, totalRepliesRes] = await Promise.all([
    deps.db<{ c: string }>(
      `SELECT COUNT(*)::text AS c
       FROM events
       WHERE client_id = $1 AND domain_id = $2 AND created_at > NOW() - INTERVAL '7 days' AND event_type = 'reply'`,
      [input.clientId, input.domainId]
    ),
    deps.db<{ c: string }>(
      `SELECT COUNT(*)::text AS c
       FROM events
       WHERE client_id = $1 AND created_at > NOW() - INTERVAL '7 days' AND event_type = 'reply'`,
      [input.clientId]
    ),
  ])
  const domainReplies = Number(domainRepliesRes.rows[0]?.c ?? 0)
  const totalReplies = Number(totalRepliesRes.rows[0]?.c ?? 0)
  const contribution = totalReplies > 0 ? clamp(domainReplies / totalReplies, 0, 1) : 0

  // A/B deltas (if present): compare outcomes for baseline vs treatment based on metadata.
  const ab = await deps.db<{ group: string; sent: string; replies: string; bounces: string }>(
    `WITH sent AS (
       SELECT
         qj.metadata->'advanced_trace'->>'experiment_group' AS grp,
         e.queue_job_id
       FROM events e
       JOIN queue_jobs qj ON qj.client_id = e.client_id AND qj.id = e.queue_job_id
       WHERE e.client_id = $1
         AND e.domain_id = $2
         AND e.created_at > NOW() - INTERVAL '14 days'
         AND e.event_type = 'sent'
         AND e.queue_job_id IS NOT NULL
         AND (qj.metadata->'advanced_trace'->>'experiment_group') IS NOT NULL
     ),
     reply AS (
       SELECT DISTINCT queue_job_id FROM events
       WHERE client_id = $1 AND domain_id = $2 AND created_at > NOW() - INTERVAL '14 days' AND event_type='reply' AND queue_job_id IS NOT NULL
     ),
     bounce AS (
       SELECT DISTINCT queue_job_id FROM events
       WHERE client_id = $1 AND domain_id = $2 AND created_at > NOW() - INTERVAL '14 days' AND event_type='bounce' AND queue_job_id IS NOT NULL
     )
     SELECT
       COALESCE(grp, 'unknown') AS "group",
       COUNT(*)::text AS sent,
       COUNT(CASE WHEN r.queue_job_id IS NOT NULL THEN 1 END)::text AS replies,
       COUNT(CASE WHEN b.queue_job_id IS NOT NULL THEN 1 END)::text AS bounces
     FROM sent s
     LEFT JOIN reply r ON r.queue_job_id = s.queue_job_id
     LEFT JOIN bounce b ON b.queue_job_id = s.queue_job_id
     GROUP BY 1`,
    [input.clientId, input.domainId]
  )

  return {
    domainId: input.domainId,
    last24h: metrics24h,
    last7d: metrics7d,
    signals: scoreSignals(metrics7d),
    lane_performance: lanePerf.rows.map((r) => {
      const sent = Number(r.sent ?? 0)
      const replies = Number(r.replies ?? 0)
      const bounces = Number(r.bounces ?? 0)
      return {
        lane: r.lane,
        sent,
        replies,
        bounces,
        reply_rate: sent > 0 ? clamp(replies / sent, 0, 1) : 0,
        bounce_rate: sent > 0 ? clamp(bounces / sent, 0, 1) : 0,
      }
    }),
    reply_contribution_7d: contribution,
    ab_experiment: (() => {
      const by = new Map<string, { sent: number; replies: number; bounces: number }>()
      for (const r of ab.rows) {
        by.set(String((r as any).group), {
          sent: Number(r.sent ?? 0),
          replies: Number(r.replies ?? 0),
          bounces: Number(r.bounces ?? 0),
        })
      }
      const base = by.get('baseline')
      const treat = by.get('treatment')
      if (!base || !treat) return null
      const baseReply = base.sent > 0 ? base.replies / base.sent : 0
      const treatReply = treat.sent > 0 ? treat.replies / treat.sent : 0
      const baseBounce = base.sent > 0 ? base.bounces / base.sent : 0
      const treatBounce = treat.sent > 0 ? treat.bounces / treat.sent : 0
      return {
        baseline: { ...base, reply_rate: clamp(baseReply, 0, 1), bounce_rate: clamp(baseBounce, 0, 1) },
        treatment: { ...treat, reply_rate: clamp(treatReply, 0, 1), bounce_rate: clamp(treatBounce, 0, 1) },
        deltas: {
          reply_rate_delta: clamp(treatReply - baseReply, -1, 1),
          bounce_rate_delta: clamp(treatBounce - baseBounce, -1, 1),
        },
      }
    })(),
  }
}

export async function getOutcomeCampaign(deps: { db: DbExecutor }, input: { clientId: number; campaignId: number }) {
  const res = await deps.db<{ sent: string; bounced: string; replied: string; meetings: string }>(
    `SELECT
       COUNT(CASE WHEN event_type='sent' THEN 1 END)::text AS sent,
       COUNT(CASE WHEN event_type='bounce' THEN 1 END)::text AS bounced,
       COUNT(CASE WHEN event_type='reply' THEN 1 END)::text AS replied,
       COUNT(CASE WHEN event_type='meeting_booked' THEN 1 END)::text AS meetings
     FROM events
     WHERE client_id = $1
       AND campaign_id = $2
       AND created_at > NOW() - INTERVAL '7 days'
       AND event_type IN ('sent','bounce','reply','meeting_booked')`,
    [input.clientId, input.campaignId]
  )
  const row = res.rows[0] ?? ({} as any)
  const sent = Number(row.sent ?? 0)
  const bounced = Number(row.bounced ?? 0)
  const replied = Number(row.replied ?? 0)
  const meetings = Number(row.meetings ?? 0)
  const reply_rate = sent > 0 ? replied / sent : 0
  const bounce_rate = sent > 0 ? bounced / sent : 0
  const meeting_rate = replied > 0 ? meetings / replied : 0

  return {
    campaignId: input.campaignId,
    last7d: {
      sent,
      bounced,
      replied,
      meetings,
      reply_rate: clamp(reply_rate, 0, 1),
      bounce_rate: clamp(bounce_rate, 0, 1),
      meeting_rate: clamp(meeting_rate, 0, 1),
    },
  }
}

export async function getOutcomeTrace(deps: { db: DbExecutor }, input: { clientId: number; traceId: string }) {
  // Find a queue job by traceId embedded in metadata.advanced_trace.traceId.
  const job = await deps.db<{ id: number; campaign_id: number | null; contact_id: number | null; domain_id: number | null; identity_id: number | null; metadata: any; scheduled_at: string | null }>(
    `SELECT id, campaign_id, contact_id, domain_id, identity_id, metadata, scheduled_at
     FROM queue_jobs
     WHERE client_id = $1
       AND (metadata->'advanced_trace'->>'traceId') = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [input.clientId, input.traceId]
  )
  const row = job.rows[0]
  if (!row) return null

  const events = await deps.db<{ event_type: string; created_at: string; metadata: any }>(
    `SELECT event_type, created_at, metadata
     FROM events
     WHERE client_id = $1 AND queue_job_id = $2
     ORDER BY created_at ASC`,
    [input.clientId, row.id]
  )

  return {
    traceId: input.traceId,
    queueJobId: row.id,
    campaignId: row.campaign_id,
    contactId: row.contact_id,
    domainId: row.domain_id,
    identityId: row.identity_id,
    scheduledAt: row.scheduled_at,
    advancedTrace: row.metadata?.advanced_trace ?? null,
    events: events.rows,
  }
}
