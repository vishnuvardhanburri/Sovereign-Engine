export interface DomainHealthInput {
  bounce_rate: number
  reply_rate: number
  spam_signals: number // 0..1
}

export interface DomainHealthResult {
  score: number // 0..100
  mode: 'scale' | 'stable' | 'throttle' | 'pause'
  per_domain_daily_cap: number
  per_inbox_daily_cap: number
  hourly_cap: number
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

export function getDomainHealth(input: DomainHealthInput): DomainHealthResult {
  const bounce = clamp01(input.bounce_rate)
  const reply = clamp01(input.reply_rate)
  const spam = clamp01(input.spam_signals)

  // Higher replies are good, bounces/spam are bad.
  const score = Math.round(
    (reply * 70) + ((1 - bounce) * 20) + ((1 - spam) * 10)
  )

  let mode: DomainHealthResult['mode'] = 'stable'
  if (score > 80) mode = 'scale'
  else if (score < 30) mode = 'pause'
  else if (score < 50) mode = 'throttle'

  // Caps keep a buffer for safety; never fully saturate.
  const perDomain = mode === 'scale' ? 50000 : mode === 'stable' ? 25000 : mode === 'throttle' ? 8000 : 0
  const perInbox = mode === 'scale' ? 400 : mode === 'stable' ? 250 : mode === 'throttle' ? 120 : 0
  const hourly = mode === 'scale' ? 2500 : mode === 'stable' ? 1200 : mode === 'throttle' ? 400 : 0

  return {
    score,
    mode,
    per_domain_daily_cap: perDomain,
    per_inbox_daily_cap: perInbox,
    hourly_cap: hourly,
  }
}

