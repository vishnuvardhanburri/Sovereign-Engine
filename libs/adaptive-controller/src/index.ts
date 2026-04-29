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
  // If true, caller should hard-stop sends (no retries) until recovery.
  hardStop: boolean
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
        hardStop: false,
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

  // Immediate hard stops (no retries).
  if (complaint > 0.005) {
    return {
      throughput: {
        maxPerMinute: 0,
        targetPerDay: 0,
        reasons: ['complaint_rate_gt_0.5_hard_stop'],
        shouldPauseDomain: true,
        hardStop: true,
        nextWindowAction: 'pause',
      },
      nextState: { ...nextStateBase, cooldownUntil: nowMs + 60 * 60_000, healthyWindows: 0 },
    }
  }

  if (bounce > 0.1) {
    return {
      throughput: {
        maxPerMinute: 0,
        targetPerDay: 0,
        reasons: ['bounce_rate_gt_10_hard_stop'],
        shouldPauseDomain: true,
        hardStop: true,
        nextWindowAction: 'pause',
      },
      nextState: { ...nextStateBase, cooldownUntil: nowMs + 60 * 60_000, healthyWindows: 0 },
    }
  }

  // Soft pause rules (retry later).
  if (complaint > 0.002) {
    return {
      throughput: {
        maxPerMinute: 0,
        targetPerDay: 0,
        reasons: ['complaint_rate_gt_0.2_pause'],
        shouldPauseDomain: true,
        hardStop: false,
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
        hardStop: false,
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
      hardStop: false,
      nextWindowAction,
    },
    nextState,
  }
}

export type ProviderLane = 'gmail' | 'outlook' | 'yahoo' | 'other'

export type AdaptiveControlSignal = {
  clientId: number
  domainId: number
  provider: ProviderLane
  state: 'warmup' | 'normal' | 'degraded' | 'cooldown' | 'paused'
  action: 'ramp' | 'hold' | 'throttle' | 'pause' | 'cooldown' | 'resume'
  maxPerHour: number
  maxPerMinute: number
  maxConcurrency: number
  ratePerSecond: number
  burst: number
  jitterPct: number
  cooldownUntil: string | null
  reasons: string[]
  metrics: {
    deferralRate1h: number
    blockRate1h: number
    sendSuccessRate1h: number
    seedPlacementInboxRate: number
    providerRisk: number
  }
}

export type AdaptiveControlEngineDeps = {
  db: DbExecutor
  redis: {
    get(key: string): Promise<string | null>
    set(key: string, value: string, modeOrTtl?: any, durationOrMode?: any, maybeMode?: any): Promise<any>
    del(...keys: string[]): Promise<any>
  }
  redisPeers?: Array<{
    region: string
    redis: AdaptiveControlEngineDeps['redis']
  }>
  region?: string
  now?: () => number
}

type PreviousReputationState = {
  state: AdaptiveControlSignal['state']
  max_per_hour?: number | string | null
  max_per_minute: number | string
  max_concurrency: number | string
  cooldown_until?: string | Date | null
  reasons?: any
  metrics_snapshot?: any
  updated_at?: string | Date | null
}

function safeJsonArray(value: any): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  }
  return []
}

function safeJsonObject(value: any): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }
  return {}
}

function hoursBetween(aMs: number, bMs: number) {
  return Math.max(0, (aMs - bMs) / (60 * 60_000))
}

export class AdaptiveControlEngine {
  private readonly db: DbExecutor
  private readonly redis: AdaptiveControlEngineDeps['redis']
  private readonly redisPeers: NonNullable<AdaptiveControlEngineDeps['redisPeers']>
  private readonly region: string
  private readonly now: () => number
  private readonly maxLanePerHour: number

  constructor(deps: AdaptiveControlEngineDeps & { maxLanePerHour?: number }) {
    this.db = deps.db
    this.redis = deps.redis
    this.redisPeers = deps.redisPeers ?? []
    this.region = deps.region ?? 'local'
    this.now = deps.now ?? (() => Date.now())
    this.maxLanePerHour = deps.maxLanePerHour ?? Number(process.env.ADAPTIVE_MAX_LANE_PER_HOUR ?? 5_000)
  }

  async runLane(clientId: number, domainId: number, provider: ProviderLane): Promise<AdaptiveControlSignal | null> {
    const input = await this.loadInputs(clientId, domainId, provider)
    if (!input) return null
    const signal = this.evaluate(input)
    await this.persistAndPublish(input.previous, signal)
    return signal
  }

  private async loadInputs(clientId: number, domainId: number, provider: ProviderLane) {
    const [domainRes, stateRes, healthRes, seedRes] = await Promise.all([
      this.db<{ id: number; created_at: string | Date; daily_limit: number | string; status: string }>(
        `SELECT id, created_at, daily_limit, status
         FROM domains
         WHERE client_id = $1 AND id = $2
         LIMIT 1`,
        [clientId, domainId]
      ),
      this.db<PreviousReputationState>(
        `SELECT state, max_per_hour, max_per_minute, max_concurrency, cooldown_until, reasons, metrics_snapshot, updated_at
         FROM reputation_state
         WHERE client_id = $1 AND domain_id = $2 AND provider = $3
         LIMIT 1`,
        [clientId, domainId, provider]
      ),
      this.db<{ deferral_rate: string | number | null; block_rate: string | number | null; success_rate: string | number | null }>(
        `SELECT deferral_rate, block_rate, success_rate
         FROM provider_health_snapshots
         WHERE client_id = $1 AND provider = $2
           AND (domain_id = $3 OR domain_id IS NULL)
         ORDER BY CASE WHEN domain_id = $3 THEN 0 ELSE 1 END, created_at DESC
         LIMIT 1`,
        [clientId, provider, domainId]
      ),
      this.db<{ total: string; inbox: string }>(
        `SELECT
           COUNT(*)::text AS total,
           COUNT(*) FILTER (WHERE placement = 'inbox')::text AS inbox
         FROM seed_placement_events
         WHERE client_id = $1 AND provider = $2
           AND created_at > (CURRENT_TIMESTAMP - INTERVAL '24 hours')`,
        [clientId, provider]
      ),
    ])

    const domain = domainRes.rows[0]
    if (!domain) return null

    const health = healthRes.rows[0]
    const seed = seedRes.rows[0]
    const seedTotal = safeNum(seed?.total, 0)
    const seedInbox = safeNum(seed?.inbox, 0)
    const seedPlacementInboxRate = seedTotal > 0 ? seedInbox / seedTotal : 1
    const deferralRate1h = clamp(safeNum(health?.deferral_rate, 0), 0, 1)
    const blockRate1h = clamp(safeNum(health?.block_rate, 0), 0, 1)
    const sendSuccessRate1h = clamp(safeNum(health?.success_rate, 1), 0, 1)

    return {
      clientId,
      domainId,
      provider,
      domain: {
        createdAtMs: new Date(domain.created_at).getTime(),
        dailyLimit: safeNum(domain.daily_limit, 400),
        status: String(domain.status ?? 'active'),
      },
      previous: stateRes.rows[0] ?? null,
      metrics: {
        deferralRate1h,
        blockRate1h,
        sendSuccessRate1h,
        seedPlacementInboxRate,
      },
    }
  }

  private evaluate(input: NonNullable<Awaited<ReturnType<AdaptiveControlEngine['loadInputs']>>>): AdaptiveControlSignal {
    const nowMs = this.now()
    const previous = input.previous
    const previousSnapshot = safeJsonObject(previous?.metrics_snapshot)
    const controlMemory = safeJsonObject(previousSnapshot.control)
    const previousMax = clamp(safeNum(previous?.max_per_hour ?? controlMemory.maxPerHour, 50), 0, this.maxLanePerHour)
    const providerRisk = clamp(
      input.metrics.deferralRate1h * 0.6 + input.metrics.blockRate1h * 1.2 + (1 - input.metrics.seedPlacementInboxRate) * 0.6,
      0,
      1
    )

    const laneCap = clamp(
      Math.min(this.maxLanePerHour, Math.max(50, Math.floor(input.domain.dailyLimit / 10))),
      50,
      this.maxLanePerHour
    )

    const reasons: string[] = []
    let action: AdaptiveControlSignal['action'] = 'hold'
    let state: AdaptiveControlSignal['state'] = previous?.state ?? 'warmup'
    let maxPerHour = previous ? Math.max(50, previousMax || 50) : 50
    let cooldownUntil: string | null = null

    if (input.metrics.blockRate1h > 0.05) {
      reasons.push('block_rate_1h_gt_5_provider_lane_pause')
      action = 'pause'
      state = 'paused'
      maxPerHour = 0
      cooldownUntil = new Date(nowMs + 60 * 60_000).toISOString()
      return this.makeSignal(input, action, state, maxPerHour, cooldownUntil, reasons, providerRisk)
    }

    const priorCooldownUntil = previous?.cooldown_until ? new Date(previous.cooldown_until).getTime() : 0
    const comingOffCooldown = priorCooldownUntil > 0 && priorCooldownUntil <= nowMs
    const domainAgeHours = hoursBetween(nowMs, input.domain.createdAtMs)
    const newOrRecovering =
      !previous ||
      previous.state === 'warmup' ||
      previous.state === 'cooldown' ||
      comingOffCooldown ||
      domainAgeHours < 48

    if (newOrRecovering) {
      state = 'warmup'
      reasons.push('safe_ramp_slow_start')
      const lastRampAt = safeNum(controlMemory.lastRampAt, 0)
      const canDouble = input.metrics.deferralRate1h < 0.02 && (!lastRampAt || nowMs - lastRampAt >= 2 * 60 * 60_000)
      if (canDouble && previous) {
        maxPerHour = Math.min(laneCap, Math.max(50, previousMax * 2))
        action = maxPerHour > previousMax ? 'ramp' : 'hold'
        if (action === 'ramp') reasons.push('safe_ramp_doubled_after_two_healthy_hours')
      } else {
        maxPerHour = Math.max(50, Math.min(previousMax || 50, laneCap))
      }
    }

    if (input.metrics.deferralRate1h >= 0.02) {
      reasons.push('deferral_rate_1h_gte_2_throttle_50')
      maxPerHour = Math.max(25, Math.floor(maxPerHour * 0.5))
      state = 'degraded'
      action = 'throttle'
    }

    if (input.metrics.seedPlacementInboxRate < 0.75) {
      reasons.push('seed_placement_inbox_rate_lt_75_throttle_50')
      maxPerHour = Math.max(25, Math.floor(maxPerHour * 0.5))
      state = 'degraded'
      action = 'throttle'
    }

    if (input.metrics.seedPlacementInboxRate < 0.5) {
      reasons.push('seed_placement_inbox_rate_lt_50_cooldown')
      state = 'cooldown'
      action = 'cooldown'
      cooldownUntil = new Date(nowMs + 30 * 60_000).toISOString()
    }

    if (state === 'paused') {
      state = 'warmup'
      action = 'resume'
      maxPerHour = 50
      reasons.push('provider_lane_resume_to_slow_start')
    }

    if (!reasons.length) reasons.push('provider_lane_healthy_hold')
    return this.makeSignal(input, action, state, Math.min(maxPerHour, laneCap), cooldownUntil, reasons, providerRisk)
  }

  private makeSignal(
    input: NonNullable<Awaited<ReturnType<AdaptiveControlEngine['loadInputs']>>>,
    action: AdaptiveControlSignal['action'],
    state: AdaptiveControlSignal['state'],
    maxPerHour: number,
    cooldownUntil: string | null,
    reasons: string[],
    providerRisk: number
  ): AdaptiveControlSignal {
    const maxPerMinute = maxPerHour > 0 ? Math.max(1, Math.ceil(maxPerHour / 60)) : 0
    const maxConcurrency = maxPerHour <= 0 ? 0 : maxPerHour <= 50 ? 1 : maxPerHour < 500 ? 2 : 3
    return {
      clientId: input.clientId,
      domainId: input.domainId,
      provider: input.provider,
      state,
      action,
      maxPerHour,
      maxPerMinute,
      maxConcurrency,
      ratePerSecond: maxPerHour > 0 ? maxPerHour / 3600 : 0,
      burst: maxPerHour > 0 ? Math.max(1, Math.min(25, Math.ceil(maxPerHour / 12))) : 0,
      jitterPct: 0.15,
      cooldownUntil,
      reasons,
      metrics: {
        ...input.metrics,
        providerRisk,
      },
    }
  }

  private async persistAndPublish(previous: PreviousReputationState | null, signal: AdaptiveControlSignal) {
    const nowMs = this.now()
    const prevReasons = safeJsonArray(previous?.reasons)
    const previousComparable = previous
      ? {
          state: previous.state,
          max_per_hour: safeNum(previous.max_per_hour, 50),
          max_per_minute: safeNum(previous.max_per_minute, 1),
          max_concurrency: safeNum(previous.max_concurrency, 1),
          reasons: prevReasons,
        }
      : null

    const control = {
      maxPerHour: signal.maxPerHour,
      lastRampAt: signal.action === 'ramp' ? nowMs : safeNum(safeJsonObject(previous?.metrics_snapshot).control?.lastRampAt, 0),
      updatedAt: new Date(nowMs).toISOString(),
    }

    await this.db(
      `INSERT INTO reputation_state (client_id, domain_id, provider, state, max_per_hour, max_per_minute, max_concurrency, cooldown_until, reasons, metrics_snapshot, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb, now())
       ON CONFLICT (client_id, domain_id, provider)
       DO UPDATE SET
         state = EXCLUDED.state,
         max_per_hour = EXCLUDED.max_per_hour,
         max_per_minute = EXCLUDED.max_per_minute,
         max_concurrency = EXCLUDED.max_concurrency,
         cooldown_until = EXCLUDED.cooldown_until,
         reasons = EXCLUDED.reasons,
         metrics_snapshot = EXCLUDED.metrics_snapshot,
         updated_at = now()`,
      [
        signal.clientId,
        signal.domainId,
        signal.provider,
        signal.state,
        signal.maxPerHour,
        signal.maxPerMinute,
        signal.maxConcurrency,
        signal.cooldownUntil,
        JSON.stringify(signal.reasons),
        JSON.stringify({ control, metrics: signal.metrics, signal }),
      ]
    )

    await this.publishSignal(signal)

    const changed =
      !previousComparable ||
      previousComparable.state !== signal.state ||
      previousComparable.max_per_hour !== signal.maxPerHour ||
      previousComparable.max_per_minute !== signal.maxPerMinute ||
      previousComparable.max_concurrency !== signal.maxConcurrency ||
      previousComparable.reasons.join('|') !== signal.reasons.join('|')

    if (!changed) return

    const eventType =
      signal.action === 'pause'
        ? 'pause'
        : signal.action === 'ramp'
          ? 'ramp'
          : signal.action === 'cooldown'
            ? 'cooldown'
            : signal.action === 'resume'
              ? 'resume'
              : signal.action === 'throttle'
                ? 'throttle'
                : 'measurement'
    const severity = signal.action === 'pause' ? 'critical' : signal.action === 'throttle' || signal.action === 'cooldown' ? 'warning' : 'info'
    const message = this.describeChange(signal)

    await this.db(
      `INSERT INTO reputation_events (client_id, domain_id, provider, event_type, severity, message, previous_state, next_state, metrics_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb)`,
      [
        signal.clientId,
        signal.domainId,
        signal.provider,
        eventType,
        severity,
        message,
        JSON.stringify(previousComparable),
        JSON.stringify({
          state: signal.state,
          max_per_hour: signal.maxPerHour,
          max_per_minute: signal.maxPerMinute,
          max_concurrency: signal.maxConcurrency,
          reasons: signal.reasons,
        }),
        JSON.stringify(signal.metrics),
      ]
    )
  }

  private async publishSignal(signal: AdaptiveControlSignal) {
    const peers = [{ region: this.region, redis: this.redis }, ...this.redisPeers]
    await Promise.allSettled(
      peers.map(async (peer) => {
        const laneKey = `xv:${peer.region}:adaptive:lane:${signal.clientId}:${signal.domainId}:${signal.provider}`
        await peer.redis.set(laneKey, JSON.stringify(signal), 'EX', 60 * 10)

        const pauseKey = `xv:${peer.region}:adaptive:lane_pause:${signal.clientId}:${signal.domainId}:${signal.provider}`
        if (signal.state === 'paused' || signal.action === 'pause') {
          await peer.redis.set(pauseKey, JSON.stringify(signal), 'EX', 60 * 60)
        } else {
          await peer.redis.del(pauseKey)
        }

        const syncKey = `xv:${peer.region}:adaptive:last_sync:${signal.clientId}:${signal.domainId}:${signal.provider}`
        await peer.redis.set(syncKey, new Date(this.now()).toISOString(), 'EX', 60 * 60)
      })
    )
  }

  private describeChange(signal: AdaptiveControlSignal): string {
    const provider = signal.provider[0].toUpperCase() + signal.provider.slice(1)
    if (signal.action === 'pause') {
      return `Paused ${provider} lane for client ${signal.clientId} domain ${signal.domainId} because block_rate_1h exceeded 5%.`
    }
    if (signal.action === 'throttle') {
      return `Throttled ${provider} lane for client ${signal.clientId} domain ${signal.domainId} to ${signal.maxPerHour}/hr due to ${signal.reasons.join(', ')}.`
    }
    if (signal.action === 'ramp') {
      return `Safe-ramped ${provider} lane for client ${signal.clientId} domain ${signal.domainId} to ${signal.maxPerHour}/hr after healthy windows.`
    }
    if (signal.action === 'cooldown') {
      return `Placed ${provider} lane for client ${signal.clientId} domain ${signal.domainId} into cooldown due to placement or provider risk.`
    }
    if (signal.action === 'resume') {
      return `Resumed ${provider} lane for client ${signal.clientId} domain ${signal.domainId} at slow-start pace.`
    }
    return `Measured ${provider} lane for client ${signal.clientId} domain ${signal.domainId}; holding ${signal.maxPerHour}/hr.`
  }
}
