import type { DbExecutor } from '@xavira/types'

export type ProviderSignals = {
  provider?: 'gmail' | 'outlook' | 'yahoo' | 'other'
  providerRisk?: number // 0..1 (higher == riskier)
  timeWindowHour?: number // 0..23
}

export type DomainSignals = {
  bounceRate24h: number // 0..1
  replyRate24h: number // 0..1
  healthScore: number // 0..100
}

export type AdaptiveThroughput = {
  // Max sends per minute for this domain (soft limit; enforced by redis counter).
  maxPerMinute: number
  // Target daily volume (used for reporting / sanity).
  targetPerDay: number
  // Human-readable reasons used in audit/metrics.
  reasons: string[]
  // If true, caller should pause domain (hard stop).
  shouldPauseDomain: boolean
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function safeNum(v: any, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export async function loadDomainSignals(db: DbExecutor, clientId: number, domainId: number): Promise<DomainSignals | null> {
  const [domainRes, evRes] = await Promise.all([
    db<{ health_score: number }>(
      `SELECT health_score
       FROM domains
       WHERE client_id = $1 AND id = $2
       LIMIT 1`,
      [clientId, domainId]
    ),
    db<{ sent: string; bounce: string; reply: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE event_type = 'sent')::text AS sent,
         COUNT(*) FILTER (WHERE event_type = 'bounce')::text AS bounce,
         COUNT(*) FILTER (WHERE event_type = 'reply')::text AS reply
       FROM events
       WHERE client_id = $1 AND domain_id = $2
         AND created_at > (CURRENT_TIMESTAMP - INTERVAL '24 hours')`,
      [clientId, domainId]
    ),
  ])

  const healthScore = safeNum(domainRes.rows[0]?.health_score, 0)
  if (!Number.isFinite(healthScore)) return null

  const sent = safeNum(evRes.rows[0]?.sent, 0)
  const bounce = safeNum(evRes.rows[0]?.bounce, 0)
  const reply = safeNum(evRes.rows[0]?.reply, 0)

  const bounceRate24h = sent > 0 ? bounce / sent : 0
  const replyRate24h = sent > 0 ? reply / sent : 0

  return { bounceRate24h, replyRate24h, healthScore }
}

// Adaptive controller:
// - never maximizes volume
// - increases slowly on healthy signals
// - decreases aggressively on bounce risk
// - pauses on dangerous bounce rate
export function computeAdaptiveThroughput(
  signals: DomainSignals | null,
  provider: ProviderSignals | undefined
): AdaptiveThroughput {
  // Conservative fallback if signals are missing.
  if (!signals) {
    return {
      maxPerMinute: 1,
      targetPerDay: 30,
      reasons: ['signals_missing_conservative'],
      shouldPauseDomain: false,
    }
  }

  const reasons: string[] = []
  const bounce = clamp(signals.bounceRate24h, 0, 1)
  const reply = clamp(signals.replyRate24h, 0, 1)
  const health = clamp(signals.healthScore, 0, 100)

  // Hard pause rule.
  if (bounce > 0.08) {
    return {
      maxPerMinute: 0,
      targetPerDay: 0,
      reasons: ['bounce_rate_gt_8_pause'],
      shouldPauseDomain: true,
    }
  }

  // Base daily target by health.
  // (These are targets, not hardcoded caps; we still enforce per-minute smoothing.)
  let targetPerDay = 50
  if (health >= 90) targetPerDay = 400
  else if (health >= 80) targetPerDay = 250
  else if (health >= 70) targetPerDay = 150
  else if (health >= 50) targetPerDay = 80
  else targetPerDay = 30

  // Bounce risk adjustments.
  if (bounce > 0.05) {
    reasons.push('bounce_rate_gt_5_decrease_aggressive')
    targetPerDay = Math.max(20, Math.floor(targetPerDay * 0.4))
  } else if (bounce > 0.03) {
    reasons.push('bounce_rate_gt_3_decrease')
    targetPerDay = Math.max(20, Math.floor(targetPerDay * 0.7))
  }

  // Reply-driven gradual increase (only if bounce is low).
  if (bounce < 0.03 && reply >= 0.03 && health >= 70) {
    reasons.push('high_reply_low_bounce_increase_gradual')
    targetPerDay = Math.floor(targetPerDay * 1.15) // +15%
  }

  // Provider risk throttling.
  const providerRisk = clamp(provider?.providerRisk ?? 0, 0, 1)
  if (providerRisk > 0.5) {
    reasons.push('provider_risk_throttle')
    targetPerDay = Math.max(20, Math.floor(targetPerDay * 0.7))
  }

  // Per-minute smoothing: spread target over 10 hours of business time by default.
  // Keep it small to avoid bursts.
  const maxPerMinute = clamp(Math.ceil(targetPerDay / (10 * 60)), 1, 20)

  if (!reasons.length) reasons.push('baseline_adaptive')

  return {
    maxPerMinute,
    targetPerDay,
    reasons,
    shouldPauseDomain: false,
  }
}

