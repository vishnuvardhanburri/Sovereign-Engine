export interface WarmupInput {
  domain_age_days: number
  current_volume: number
  reply_rate: number
  bounce_rate: number
  domain_health: number
}

export interface WarmupOutput {
  allowed_volume: number
  warmup_stage: 'early' | 'week_2' | 'week_3' | 'week_4' | 'week_5' | 'stable'
  adjustment: number
  safe: boolean
  reason: string
}

const WARMUP_PROMPT = `You are a warmup intelligence agent for outbound domain sending.
Gradually increase sending volume while keeping deliverability safe.
Apply the following rules:
- Day 1–7 → max 20 emails/day
- Day 7–14 → increase 20% daily
- If reply_rate > 5% → accelerate
- If bounce_rate > 3% → reduce
- If domain_health < 60 → freeze growth

Return ONLY JSON.`

export async function assessWarmup(input: WarmupInput): Promise<WarmupOutput> {
  const age = Math.max(0, input.domain_age_days)
  const warmupStage =
    age <= 7
      ? 'early'
      : age <= 14
      ? 'week_2'
      : age <= 21
      ? 'week_3'
      : age <= 28
      ? 'week_4'
      : age <= 35
      ? 'week_5'
      : 'stable'

  const stageLimits: Record<string, number> = {
    early: 20,
    week_2: 100,
    week_3: 200,
    week_4: 400,
    week_5: 800,
    stable: 1000,
  }

  let allowed_volume = stageLimits[warmupStage]
  let safe = true
  let adjustment = 0
  let reason = 'Domain warmup is on track.'

  if (input.domain_health < 60) {
    safe = false
    allowed_volume = Math.min(20, allowed_volume)
    adjustment = -Math.max(1, Math.round(allowed_volume * 0.5))
    reason = 'Domain health is low; freezing growth until health improves.'
  }

  if (input.bounce_rate > 3) {
    safe = false
    allowed_volume = Math.max(1, Math.round(allowed_volume * 0.5))
    adjustment = -Math.max(1, Math.round(allowed_volume * 0.5))
    reason = 'Bounce rate has exceeded 3%; reducing warmup volume.'
  }

  if (input.reply_rate > 5 && safe) {
    const accelerated = Math.min(1000, Math.round(allowed_volume * 1.2))
    adjustment = Math.max(0, accelerated - allowed_volume)
    allowed_volume = accelerated
    reason = 'Reply rate is strong; accelerating warmup volume safely.'
  }

  allowed_volume = Math.max(1, allowed_volume)

  return {
    allowed_volume,
    warmup_stage: warmupStage,
    adjustment,
    safe,
    reason,
  }
}

export { WARMUP_PROMPT }
