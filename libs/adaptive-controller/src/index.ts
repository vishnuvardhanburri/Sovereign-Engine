import type { DbExecutor } from '@xavira/types'

export type ProviderSignals = {
  provider?: 'gmail' | 'outlook' | 'yahoo' | 'other'
  providerRisk?: number // 0..1 (higher == riskier)
  timeWindowHour?: number // 0..23
}

export type DomainSignals = {
  bounceRate24h: number // 0..1
  replyRate24h: number // 0..1
  complaintRate24h: number // 0..1
  // Tempfail signals (last hour).
  deferralRate1h: number // 0..1
  blockRate1h: number // 0..1
  sendSuccessRate1h: number // 0..1
  healthScore: number // 0..100
}

export type AdaptiveState = {
  // Smoothed signals (EMA).
  emaBounce24h?: number
  emaReply24h?: number
  emaComplaint24h?: number
  emaDeferral1h?: number
  emaBlock1h?: number
  emaSuccess1h?: number

  // Control loop memory.
  throughputCurrent?: number
  lastIncreaseAt?: number // epoch ms
  cooldownUntil?: number // epoch ms
  healthyWindows?: number
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
  // Increase/hold/decrease/pause for next window (explainability).
  nextWindowAction: 'increase' | 'hold' | 'decrease' | 'pause'
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
    db<{
      sent_24h: string
      bounce_24h: string
      reply_24h: string
      complaint_24h: string
      sent_1h: string
      failed_1h: string
      deferral_1h: string
      block_1h: string
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE event_type = 'sent' AND created_at > (CURRENT_TIMESTAMP - INTERVAL '24 hours'))::text AS sent_24h,
         COUNT(*) FILTER (WHERE event_type = 'bounce' AND created_at > (CURRENT_TIMESTAMP - INTERVAL '24 hours'))::text AS bounce_24h,
         COUNT(*) FILTER (WHERE event_type = 'reply' AND created_at > (CURRENT_TIMESTAMP - INTERVAL '24 hours'))::text AS reply_24h,
         COUNT(*) FILTER (WHERE event_type = 'complaint' AND created_at > (CURRENT_TIMESTAMP - INTERVAL '24 hours'))::text AS complaint_24h,

         COUNT(*) FILTER (WHERE event_type = 'sent' AND created_at > (CURRENT_TIMESTAMP - INTERVAL '1 hour'))::text AS sent_1h,
         COUNT(*) FILTER (WHERE event_type = 'failed' AND created_at > (CURRENT_TIMESTAMP - INTERVAL '1 hour'))::text AS failed_1h,
         COUNT(*) FILTER (WHERE event_type = 'failed'
           AND created_at > (CURRENT_TIMESTAMP - INTERVAL '1 hour')
           AND COALESCE(metadata->>'smtp_class','') = 'deferral')::text AS deferral_1h,
         COUNT(*) FILTER (WHERE event_type = 'failed'
           AND created_at > (CURRENT_TIMESTAMP - INTERVAL '1 hour')
           AND COALESCE(metadata->>'smtp_class','') = 'block')::text AS block_1h
       FROM events
       WHERE client_id = $1 AND domain_id = $2`,
      [clientId, domainId]
    ),
  ])

  const healthScore = safeNum(domainRes.rows[0]?.health_score, 0)
  if (!Number.isFinite(healthScore)) return null

  const sent24h = safeNum(evRes.rows[0]?.sent_24h, 0)
  const bounce24h = safeNum(evRes.rows[0]?.bounce_24h, 0)
  const reply24h = safeNum(evRes.rows[0]?.reply_24h, 0)
  const complaint24h = safeNum(evRes.rows[0]?.complaint_24h, 0)

  const sent1h = safeNum(evRes.rows[0]?.sent_1h, 0)
  const failed1h = safeNum(evRes.rows[0]?.failed_1h, 0)
  const deferral1h = safeNum(evRes.rows[0]?.deferral_1h, 0)
  const block1h = safeNum(evRes.rows[0]?.block_1h, 0)

  const bounceRate24h = sent24h > 0 ? bounce24h / sent24h : 0
  const replyRate24h = sent24h > 0 ? reply24h / sent24h : 0
  const complaintRate24h = sent24h > 0 ? complaint24h / sent24h : 0

  const attempts1h = sent1h + failed1h
  const deferralRate1h = attempts1h > 0 ? deferral1h / attempts1h : 0
  const blockRate1h = attempts1h > 0 ? block1h / attempts1h : 0
  const sendSuccessRate1h = attempts1h > 0 ? sent1h / attempts1h : 1

  return {
    bounceRate24h,
    replyRate24h,
    complaintRate24h,
    deferralRate1h,
    blockRate1h,
    sendSuccessRate1h,
    healthScore,
  }
}

function ema(prev: number | undefined, next: number, alpha: number) {
  if (!Number.isFinite(prev as any)) return next
  return alpha * next + (1 - alpha) * (prev as number)
}

function providerCeilPerMinute(provider: ProviderSignals | undefined) {
  // Provider-aware ceilings (recipient provider).
  // Gmail: strict ramp. Outlook: strict on bursts. Others: moderate.
  const p = provider?.provider ?? 'other'
  if (p === 'gmail') return 8
  if (p === 'outlook') return 10
  if (p === 'yahoo') return 8
  return 15
}

// Computes adaptive throughput and updated controller state.
// - multi-signal gating (complaints/deferrals/blocks)
// - EMA smoothing
// - ramp profile + cooldown windows
// - provider-aware ceilings
export function computeAdaptiveThroughput(
  signals: DomainSignals | null,
  provider: ProviderSignals | undefined,
  state: AdaptiveState | undefined,
  nowMs = Date.now()
): { throughput: AdaptiveThroughput; nextState: AdaptiveState } {
  // Conservative fallback if signals are missing.
  if (!signals) {
    const nextState: AdaptiveState = {
      ...(state ?? {}),
      throughputCurrent: Math.min(state?.throughputCurrent ?? 2, 2),
      healthyWindows: 0,
    }
    return {
      throughput: {
        maxPerMinute: 2,
        targetPerDay: 30,
        reasons: ['signals_missing_conservative'],
        shouldPauseDomain: false,
        nextWindowAction: 'hold',
      },
      nextState,
    }
  }

  const reasons: string[] = []
  const bounceRaw = clamp(signals.bounceRate24h, 0, 1)
  const replyRaw = clamp(signals.replyRate24h, 0, 1)
  const complaintRaw = clamp(signals.complaintRate24h, 0, 1)
  const deferralRaw = clamp(signals.deferralRate1h, 0, 1)
  const blockRaw = clamp(signals.blockRate1h, 0, 1)
  const successRaw = clamp(signals.sendSuccessRate1h, 0, 1)
  const health = clamp(signals.healthScore, 0, 100)

  const prev = state ?? {}

  // EMA smoothing: alpha 0.3 (24h), 0.6 (1h)
  const bounce = clamp(ema(prev.emaBounce24h, bounceRaw, 0.3), 0, 1)
  const reply = clamp(ema(prev.emaReply24h, replyRaw, 0.3), 0, 1)
  const complaint = clamp(ema(prev.emaComplaint24h, complaintRaw, 0.3), 0, 1)
  const deferral = clamp(ema(prev.emaDeferral1h, deferralRaw, 0.6), 0, 1)
  const block = clamp(ema(prev.emaBlock1h, blockRaw, 0.6), 0, 1)
  const success = clamp(ema(prev.emaSuccess1h, successRaw, 0.6), 0, 1)

  // Update signal EMAs even if we pause/cooldown.
  const nextStateBase: AdaptiveState = {
    ...prev,
    emaBounce24h: bounce,
    emaReply24h: reply,
    emaComplaint24h: complaint,
    emaDeferral1h: deferral,
    emaBlock1h: block,
    emaSuccess1h: success,
  }

  // Immediate hard stops.
  if (complaint > 0.002) {
    return {
      throughput: {
        maxPerMinute: 0,
        targetPerDay: 0,
        reasons: ['complaint_rate_gt_0.2_pause'],
        shouldPauseDomain: true,
        nextWindowAction: 'pause',
      },
      nextState: { ...nextStateBase, cooldownUntil: nowMs + 60 * 60_000, healthyWindows: 0 },
    }
  }

  if (bounce > 0.08) {
    return {
      throughput: {
        maxPerMinute: 0,
        targetPerDay: 0,
        reasons: ['bounce_rate_gt_8_pause'],
        shouldPauseDomain: true,
        nextWindowAction: 'pause',
      },
      nextState: { ...nextStateBase, cooldownUntil: nowMs + 60 * 60_000, healthyWindows: 0 },
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

  // Deferral / block gating (provider throttles, temp fails).
  // Deferral spike => halve throughput.
  if (deferral > 0.1) {
    reasons.push('deferral_rate_spike_halve')
    targetPerDay = Math.max(20, Math.floor(targetPerDay * 0.5))
  }

  // Block detected => enter cooldown window (30-60m) + reduce throughput to 20-40%.
  let cooldownUntil = prev.cooldownUntil ?? 0
  if (block > 0.01) {
    reasons.push('block_rate_detected_cooldown')
    cooldownUntil = Math.max(cooldownUntil, nowMs + 60 * 60_000)
    targetPerDay = Math.max(20, Math.floor(targetPerDay * 0.3))
  }

  // Health restriction.
  if (health < 40) {
    reasons.push('domain_health_low_restrict')
    targetPerDay = Math.max(20, Math.floor(targetPerDay * 0.6))
  }

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
    targetPerDay = Math.floor(targetPerDay * 1.15) // +15% (candidate, ramp rules apply below)
  }

  // Provider risk throttling.
  const providerRisk = clamp(provider?.providerRisk ?? 0, 0, 1)
  if (providerRisk > 0.5) {
    reasons.push('provider_risk_throttle')
    targetPerDay = Math.max(20, Math.floor(targetPerDay * 0.7))
  }

  // Per-minute smoothing: spread target over 10 hours of business time by default.
  let desiredPerMinute = clamp(Math.ceil(targetPerDay / (10 * 60)), 2, 60)

  // Ramp profile (anti-spike).
  // - cold start: 2..5/min
  // - ramp step: +10-15% per hour (only if healthy)
  // - never increase twice within the same hour
  const ceil = providerCeilPerMinute(provider)
  const coldStartMax = clamp(prev.throughputCurrent ?? 0, 0, 5) || 5
  const current = clamp(prev.throughputCurrent ?? coldStartMax, 2, ceil)
  const inCooldown = (cooldownUntil ?? 0) > nowMs
  let healthyWindows = prev.healthyWindows ?? 0

  const riskNow = bounce > 0.05 || deferral > 0.1 || block > 0.01 || health < 40 || success < 0.9
  if (riskNow) healthyWindows = 0
  else healthyWindows = clamp(healthyWindows + 1, 0, 10)

  let nextWindowAction: AdaptiveThroughput['nextWindowAction'] = 'hold'

  if (inCooldown) {
    nextWindowAction = 'decrease'
    reasons.push('cooldown_active')
    desiredPerMinute = Math.max(2, Math.floor(current * 0.3))
  } else if (riskNow) {
    nextWindowAction = 'decrease'
    desiredPerMinute = Math.max(2, Math.floor(current * 0.6))
  } else {
    // Healthy: only allow ramp if we have 2 consecutive healthy windows and haven't increased in the last hour.
    const lastIncreaseAt = prev.lastIncreaseAt ?? 0
    const canIncrease = healthyWindows >= 2 && nowMs - lastIncreaseAt >= 60 * 60_000
    if (canIncrease && desiredPerMinute > current) {
      nextWindowAction = 'increase'
      const step = provider?.provider === 'gmail' ? 1.1 : provider?.provider === 'outlook' ? 1.12 : 1.15
      desiredPerMinute = Math.min(ceil, Math.max(current + 1, Math.floor(current * step)))
    } else {
      desiredPerMinute = Math.min(ceil, Math.max(2, Math.min(desiredPerMinute, current)))
    }
  }

  const maxPerMinute = clamp(desiredPerMinute, 2, ceil)
  if (maxPerMinute < current) nextWindowAction = 'decrease'

  if (!reasons.length) reasons.push('baseline_adaptive')

  const nextState: AdaptiveState = {
    ...nextStateBase,
    throughputCurrent: maxPerMinute,
    cooldownUntil,
    healthyWindows,
    lastIncreaseAt:
      nextWindowAction === 'increase' ? nowMs : prev.lastIncreaseAt,
  }

  return {
    throughput: {
      maxPerMinute,
      targetPerDay,
      reasons,
      shouldPauseDomain: false,
      nextWindowAction,
    },
    nextState,
  }
}
