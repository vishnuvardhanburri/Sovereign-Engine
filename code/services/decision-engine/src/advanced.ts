import type { Lane, ValidationVerdict } from '@sovereign/types'
import type { SimulationOutput } from '@sovereign/simulation-engine'

export type AdvancedDecision =
  | { action: 'drop'; reason: string }
  | { action: 'send_now'; lane: Lane; reason: string }
  | { action: 'send_later'; lane: Lane; delayMs: number; reason: string }
  | { action: 'shift_domain'; lane: Lane; reason: string }

export interface AdvancedDecisionInput {
  verdict: ValidationVerdict
  domainHealthy: boolean
  simulation?: SimulationOutput
  revenueProbability?: number // 0..1
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

export function decideAdvanced(input: AdvancedDecisionInput): AdvancedDecision {
  if (input.verdict === 'invalid') return { action: 'drop', reason: 'validator_invalid' }
  if (input.verdict === 'unknown') return { action: 'send_later', lane: 'slow', delayMs: 6 * 60 * 60_000, reason: 'validator_unknown' }

  const simBounce = clamp(input.simulation?.predicted_bounce_risk ?? 0.05, 0, 1)
  const simReply = clamp(input.simulation?.predicted_reply_probability ?? 0.02, 0, 1)
  const revenue = clamp(input.revenueProbability ?? 0.5, 0, 1)

  // Safety first: high predicted bounce => slow down or shift.
  if (simBounce > 0.12) {
    return input.domainHealthy
      ? { action: 'send_later', lane: 'slow', delayMs: 12 * 60 * 60_000, reason: 'high_simulated_bounce_risk' }
      : { action: 'shift_domain', lane: 'slow', reason: 'high_bounce_and_domain_unhealthy' }
  }

  // Risky verdict routes to low-risk/slow.
  if (input.verdict === 'risky') {
    return { action: 'send_later', lane: 'low_risk', delayMs: 60 * 60_000, reason: 'validator_risky' }
  }

  // Revenue-aware: if low reply and low revenue, deprioritize.
  if (simReply < 0.02 && revenue < 0.4) {
    return { action: 'send_later', lane: 'slow', delayMs: 24 * 60 * 60_000, reason: 'low_yield_segment' }
  }

  // Healthy: send now, but lane-bias if reply is weak.
  if (simReply < 0.02) {
    return { action: 'send_now', lane: 'low_risk', reason: 'low_reply_probability_bias' }
  }
  return { action: 'send_now', lane: 'normal', reason: 'greenlight' }
}

