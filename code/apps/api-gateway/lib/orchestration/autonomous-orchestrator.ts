import { query } from '@/lib/db'
import { decideOutboundAction } from '@/lib/decision/operational-decision'
import { appendOperationalEvent } from '@/lib/operational-events'
import { isCircuitBreakerOpen, tripCircuitBreaker } from '@/lib/observability/circuit-breaker'

interface CandidateRow {
  contact_id: string
  email: string
  priority_score: string
  deliverability_risk_score: string
  evidence_count: string
  suppression_count: string
}

export async function updateProviderLaneTelemetry(clientId: number) {
  await query(
    `WITH stats AS (
       SELECT
         CASE
           WHEN lower(COALESCE(e.metadata->>'to_email','')) LIKE '%@gmail.com' THEN 'gmail'
           WHEN lower(COALESCE(e.metadata->>'to_email','')) LIKE ANY (ARRAY['%@outlook.com','%@hotmail.com','%@live.com']) THEN 'outlook'
           WHEN lower(COALESCE(e.metadata->>'to_email','')) LIKE '%@yahoo.com' THEN 'yahoo'
           WHEN lower(COALESCE(e.metadata->>'to_email','')) LIKE '%@icloud.com' THEN 'icloud'
           ELSE 'other'
         END AS provider,
         COUNT(*) FILTER (WHERE e.event_type = 'sent')::numeric AS sent,
         COUNT(*) FILTER (WHERE e.event_type = 'failed')::numeric AS failed,
         COUNT(*) FILTER (WHERE e.event_type = 'bounce')::numeric AS bounced,
         COUNT(*) FILTER (WHERE e.event_type = 'reply')::numeric AS replies
       FROM events e
       WHERE e.client_id = $1
         AND e.created_at > now() - INTERVAL '24 hours'
       GROUP BY 1
     )
     UPDATE provider_lanes lanes
     SET failure_rate_24h = CASE WHEN stats.sent > 0 THEN LEAST(1, stats.failed / stats.sent) ELSE 0 END,
         bounce_rate_24h = CASE WHEN stats.sent > 0 THEN LEAST(1, stats.bounced / stats.sent) ELSE 0 END,
         reply_rate_7d = COALESCE(lanes.reply_rate_7d, 0),
         status = CASE
           WHEN stats.sent > 0 AND (stats.failed + stats.bounced) / stats.sent >= 0.25 THEN 'recovery'
           WHEN lanes.status = 'paused' THEN 'paused'
           ELSE 'active'
         END,
         emergency_brake_active = CASE
           WHEN stats.sent >= 10 AND (stats.failed + stats.bounced) / stats.sent >= 0.40 THEN true
           ELSE lanes.emergency_brake_active
         END,
         telemetry = lanes.telemetry || jsonb_build_object(
           'last_sampled_at', now(),
           'sent24h', stats.sent,
           'failed24h', stats.failed,
           'bounced24h', stats.bounced,
           'replies24h', stats.replies
         ),
         updated_at = now()
     FROM stats
     WHERE lanes.client_id = $1
       AND lanes.provider = stats.provider`,
    [clientId]
  )
}

export async function runAutonomousOutboundDecisions(input: { clientId: number; limit?: number }) {
  const clientId = input.clientId
  if (await isCircuitBreakerOpen({ clientId, scope: 'outbound:sending' })) {
    return { evaluated: 0, held: 0, throttled: 0, sendable: 0, reason: 'circuit_breaker_open' }
  }

  await updateProviderLaneTelemetry(clientId)

  const candidates = await query<CandidateRow>(
    `SELECT c.id::text AS contact_id,
            c.email,
            COALESCE(ci.priority_score, 0)::text AS priority_score,
            COALESCE(ci.deliverability_risk_score, 50)::text AS deliverability_risk_score,
            COUNT(pe.id)::text AS evidence_count,
            COUNT(sl.id)::text AS suppression_count
     FROM contacts c
     LEFT JOIN contact_intelligence ci ON ci.client_id = c.client_id AND ci.contact_id = c.id
     LEFT JOIN public_email_evidence pe ON pe.client_id = c.client_id AND lower(pe.email_address) = lower(c.email)
     LEFT JOIN suppression_list sl ON sl.client_id = c.client_id AND lower(sl.email) = lower(c.email)
     WHERE c.client_id = $1
       AND c.status = 'active'
       AND c.verification_status IN ('valid','unknown','catch_all','pending')
     GROUP BY c.id, c.email, ci.priority_score, ci.deliverability_risk_score
     ORDER BY COALESCE(ci.priority_score, 0) DESC, c.created_at DESC
     LIMIT $2`,
    [clientId, Math.min(Math.max(input.limit ?? 100, 1), 1000)]
  )

  let sendable = 0
  let held = 0
  let throttled = 0
  for (const row of candidates.rows) {
    const decision = await decideOutboundAction({
      clientId,
      email: row.email,
      priorityScore: Number(row.priority_score),
      deliverabilityRiskScore: Number(row.deliverability_risk_score),
      hasPublicEvidence: Number(row.evidence_count) > 0,
      suppressionMatched: Number(row.suppression_count) > 0,
    })

    if (decision.action === 'send') sendable += 1
    if (decision.action === 'hold' || decision.action === 'suppress') held += 1
    if (decision.action === 'throttle') throttled += 1

    await appendOperationalEvent({
      clientId,
      eventType: 'orchestration.decision',
      aggregateType: 'contact',
      aggregateId: row.contact_id,
      actorType: 'worker',
      payload: { ...decision },
    })
  }

  const pressure = candidates.rows.length > 0 ? held / candidates.rows.length : 0
  if (pressure > 0.8 && candidates.rows.length >= 25) {
    await tripCircuitBreaker({
      clientId,
      scope: 'outbound:qualification',
      reason: 'qualification_hold_pressure',
      ttlSeconds: 60 * 20,
      metadata: { evaluated: candidates.rows.length, held },
    })
  }

  return { evaluated: candidates.rows.length, sendable, held, throttled, reason: 'evaluated' }
}
