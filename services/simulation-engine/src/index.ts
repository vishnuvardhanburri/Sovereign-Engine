import type { DbExecutor, Lane } from '@sovereign/types'

export interface SimulationDeps {
  db: DbExecutor
}

export interface SimulationInput {
  clientId: number
  domainId: number
  identityId: number
  lane: Lane
}

export interface SimulationOutput {
  predicted_bounce_risk: number // 0..1
  predicted_reply_probability: number // 0..1
  reasons: string[]
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

/**
 * Lightweight deliverability simulator (adapter-mode):
 * - uses existing domain bounce_rate/health_score
 * - uses last 7d reply_rate from events
 * - lane adds conservative bias
 */
export async function simulate(deps: SimulationDeps, input: SimulationInput): Promise<SimulationOutput> {
  const domainRes = await deps.db<{ bounce_rate: string; health_score: string }>(
    `SELECT bounce_rate::text, health_score::text
     FROM domains
     WHERE client_id = $1 AND id = $2
     LIMIT 1`,
    [input.clientId, input.domainId]
  )
  const domain = domainRes.rows[0]
  const bounceRatePct = Number(domain?.bounce_rate ?? 0)
  const health = Number(domain?.health_score ?? 100) / 100

  const events = await deps.db<{ sent: string; replies: string }>(
    `SELECT
       COUNT(CASE WHEN event_type='sent' THEN 1 END)::text AS sent,
       COUNT(CASE WHEN event_type='reply' THEN 1 END)::text AS replies
     FROM events
     WHERE client_id = $1
       AND domain_id = $2
       AND created_at > NOW() - INTERVAL '7 days'`,
    [input.clientId, input.domainId]
  )
  const sent = Number(events.rows[0]?.sent ?? 0)
  const replies = Number(events.rows[0]?.replies ?? 0)
  const replyRate = sent > 0 ? replies / sent : 0.02

  const reasons: string[] = []
  let predictedBounceRisk = clamp(bounceRatePct / 100, 0, 1)
  let predictedReplyProbability = clamp(replyRate, 0, 1)

  // Health penalty.
  predictedBounceRisk = clamp(predictedBounceRisk + (1 - health) * 0.15, 0, 1)
  predictedReplyProbability = clamp(predictedReplyProbability * (0.7 + health * 0.3), 0, 1)

  // Lane bias.
  if (input.lane === 'slow') {
    predictedBounceRisk = clamp(predictedBounceRisk * 0.85, 0, 1)
    predictedReplyProbability = clamp(predictedReplyProbability * 0.95, 0, 1)
    reasons.push('slow_lane_bias')
  } else if (input.lane === 'low_risk') {
    predictedBounceRisk = clamp(predictedBounceRisk * 0.9, 0, 1)
    predictedReplyProbability = clamp(predictedReplyProbability * 0.98, 0, 1)
    reasons.push('low_risk_bias')
  }

  if (bounceRatePct > 5) reasons.push('high_bounce_history')
  if (replyRate < 0.02) reasons.push('low_reply_history')

  return {
    predicted_bounce_risk: predictedBounceRisk,
    predicted_reply_probability: predictedReplyProbability,
    reasons,
  }
}

