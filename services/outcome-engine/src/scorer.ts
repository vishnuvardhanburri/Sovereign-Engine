export type SegmentMetrics = {
  window: '24h' | '7d'
  sent: number
  bounced: number
  replied: number
  meetings: number
  // Weighted counts (time-decayed) used to reduce overfitting to old data.
  weighted_sent: number
  weighted_bounced: number
  weighted_replied: number
  weighted_meetings: number
  reply_rate: number
  meeting_rate: number
  bounce_rate: number
  best_time_windows: number[] // hour buckets sorted best-first
  preferred_lane: 'normal' | 'low_risk' | 'slow'
  stability: {
    min_samples_ok: boolean // sent >= 20
    replies_mature: boolean // replies >= 5
    reason?: string
  }
}

export type OutcomeSignals = {
  available: boolean
  expected_reply_prob: number
  risk_adjustment: number // 0..0.1 (capped)
  best_time_window?: number
  preferred_lane?: 'normal' | 'low_risk' | 'slow'
  reasons: string[]
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

export function scoreSignals(metrics: SegmentMetrics): OutcomeSignals {
  const reasons: string[] = []

  if (!metrics.stability.min_samples_ok) {
    return {
      available: false,
      expected_reply_prob: 0,
      risk_adjustment: 0,
      reasons: ['insufficient_samples'],
    }
  }

  // risk_adjustment: treat bounce_rate as primary risk signal, but cap influence.
  const risk_adjustment = clamp(metrics.bounce_rate, 0, 0.1)
  if (risk_adjustment > 0.08) reasons.push('bounce_risk_guardrail')

  // expected_reply_prob: only mature after enough replies.
  const expected_reply_prob = metrics.stability.replies_mature ? clamp(metrics.reply_rate, 0, 0.25) : 0
  if (metrics.stability.replies_mature) {
    if (expected_reply_prob >= 0.04) reasons.push('high_reply_segment')
    if (expected_reply_prob > 0 && expected_reply_prob < 0.02) reasons.push('low_reply_segment')
  } else {
    reasons.push('reply_rate_not_mature')
  }

  const best_time_window = metrics.best_time_windows[0]
  if (typeof best_time_window === 'number') reasons.push('best_time_window')

  const preferred_lane = metrics.preferred_lane
  if (preferred_lane !== 'normal') reasons.push('preferred_lane_conservative')

  return {
    available: true,
    expected_reply_prob,
    risk_adjustment,
    best_time_window,
    preferred_lane,
    reasons,
  }
}
