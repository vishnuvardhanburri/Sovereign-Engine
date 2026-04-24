import type { OutcomeSignals } from './scorer'

export type OutcomeAdjustment = {
  recommended_lane?: 'normal' | 'low_risk' | 'slow'
  recommended_hour?: number
  risk_block?: boolean
  reason: string
}

export function proposeAdjustment(signals: OutcomeSignals): OutcomeAdjustment {
  // Fail-safe: never encourage aggression under high bounce risk.
  if (signals.risk_adjustment > 0.08) {
    return { risk_block: true, recommended_lane: 'slow', reason: 'bounce_risk_guardrail' }
  }

  // Cap boosts: only small directional hints.
  if (signals.expected_reply_prob >= 0.04 && signals.preferred_lane === 'normal') {
    return { recommended_lane: 'normal', recommended_hour: signals.best_time_window, reason: 'high_reply_segment' }
  }

  if (signals.expected_reply_prob < 0.02) {
    return { recommended_lane: signals.preferred_lane ?? 'low_risk', recommended_hour: signals.best_time_window, reason: 'low_reply_segment' }
  }

  return { recommended_lane: signals.preferred_lane, recommended_hour: signals.best_time_window, reason: 'baseline' }
}

