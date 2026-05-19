export type DomainRecoverySignal = {
  id: number | string
  domain: string
  status: string
  paused: boolean | string | null
  sent_count: number | string | null
  bounce_count: number | string | null
  health_score: number | string | null
  bounce_rate: number | string | null
  daily_limit: number | string | null
  daily_cap: number | string | null
  sent_today: number | string | null
  spf_valid?: boolean | string | null
  dkim_valid?: boolean | string | null
  dmarc_valid?: boolean | string | null
}

export type DomainRecoveryMetrics = {
  sentCount: number
  bounceCount: number
  rawBounceRatePct: number
  storedBounceRatePct: number
  healthScore: number
  sentToday: number
  dailyLimit: number
  dailyCap: number | null
  spfValid: boolean
  dkimValid: boolean
  dmarcValid: boolean
}

export type DomainRecoveryReason =
  | 'reputation_recovery_bounce_pressure'
  | 'reputation_recovery_low_health'

export type DomainRecoveryAction = {
  domainId: number
  domain: string
  reason: DomainRecoveryReason
  recommendedDailyCap: 0
  cooldownHours: number
  metrics: DomainRecoveryMetrics
}

type RecoveryThresholds = {
  minBounceCount: number
  minSentCount: number
  bounceRatePct: number
  lowHealthScore: number
  cooldownHours: number
}

const DEFAULT_THRESHOLDS: RecoveryThresholds = {
  minBounceCount: 3,
  minSentCount: 10,
  bounceRatePct: 5,
  lowHealthScore: 30,
  cooldownHours: 24,
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
  return false
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export function domainRecoveryMetrics(domain: DomainRecoverySignal): DomainRecoveryMetrics {
  const sentCount = Math.max(0, Math.trunc(toNumber(domain.sent_count)))
  const bounceCount = Math.max(0, Math.trunc(toNumber(domain.bounce_count)))
  const rawBounceRatePct = sentCount > 0 ? round2((bounceCount / sentCount) * 100) : 0
  const storedBounceRatePct = round2(Math.max(0, toNumber(domain.bounce_rate)))
  const dailyCap =
    domain.daily_cap === null || domain.daily_cap === undefined
      ? null
      : Math.max(0, Math.trunc(toNumber(domain.daily_cap)))

  return {
    sentCount,
    bounceCount,
    rawBounceRatePct,
    storedBounceRatePct,
    healthScore: round2(toNumber(domain.health_score, 100)),
    sentToday: Math.max(0, Math.trunc(toNumber(domain.sent_today))),
    dailyLimit: Math.max(0, Math.trunc(toNumber(domain.daily_limit))),
    dailyCap,
    spfValid: toBoolean(domain.spf_valid),
    dkimValid: toBoolean(domain.dkim_valid),
    dmarcValid: toBoolean(domain.dmarc_valid),
  }
}

export function buildDomainRecoveryActions(
  domains: DomainRecoverySignal[],
  thresholds: Partial<RecoveryThresholds> = {}
): DomainRecoveryAction[] {
  const policy = { ...DEFAULT_THRESHOLDS, ...thresholds }

  return domains.flatMap((domain) => {
    const domainId = Math.trunc(toNumber(domain.id))
    if (!domainId || !domain.domain) return []
    if (domain.status !== 'active' || toBoolean(domain.paused)) return []

    const metrics = domainRecoveryMetrics(domain)
    const hasEnoughSample =
      metrics.sentCount >= policy.minSentCount || metrics.bounceCount >= policy.minBounceCount
    const hasBouncePressure =
      hasEnoughSample &&
      metrics.bounceCount >= policy.minBounceCount &&
      metrics.rawBounceRatePct > policy.bounceRatePct
    const hasLowHealth = hasEnoughSample && metrics.healthScore <= policy.lowHealthScore

    const reason: DomainRecoveryReason | null = hasBouncePressure
      ? 'reputation_recovery_bounce_pressure'
      : hasLowHealth
        ? 'reputation_recovery_low_health'
        : null

    if (!reason) return []

    return [
      {
        domainId,
        domain: domain.domain,
        reason,
        recommendedDailyCap: 0,
        cooldownHours: policy.cooldownHours,
        metrics,
      },
    ]
  })
}
