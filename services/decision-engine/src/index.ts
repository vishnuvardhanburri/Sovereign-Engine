export type ValidationVerdict = 'valid' | 'risky' | 'invalid' | 'unknown'

export type SendLane = 'normal' | 'low_risk' | 'slow'

export interface DecisionInput {
  email: string
  verdict: ValidationVerdict
  score: number
  domainScore?: number
  catchAll?: boolean
}

export type DecisionOutput =
  | { action: 'drop'; reason: string }
  | { action: 'retry_later'; reason: string; delayMs: number }
  | { action: 'send'; lane: SendLane; reason: string }

/**
 * Pure decision function. Queue/persistence lives in the worker/api layers.
 */
export function decide(input: DecisionInput): DecisionOutput {
  if (input.verdict === 'invalid') return { action: 'drop', reason: 'validator_invalid' }
  if (input.verdict === 'unknown') return { action: 'retry_later', reason: 'validator_unknown', delayMs: 6 * 60 * 60_000 }

  const domainScore = typeof input.domainScore === 'number' ? input.domainScore : 1
  const isCatchAll = Boolean(input.catchAll)

  if (isCatchAll) {
    return { action: 'send', lane: 'slow', reason: 'catch_all_slow_lane' }
  }

  if (input.verdict === 'risky') {
    return { action: 'send', lane: 'low_risk', reason: 'validator_risky_low_risk_lane' }
  }

  // valid
  if (domainScore < 0.6) {
    return { action: 'send', lane: 'low_risk', reason: 'low_domain_score_route_low_risk' }
  }
  return { action: 'send', lane: 'normal', reason: 'validator_valid' }
}

export { decideAdvanced } from './advanced'
