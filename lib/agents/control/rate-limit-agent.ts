import { queryOne } from '@/lib/db'

export interface RateLimitInput {
  clientId: number
  requestedVolume: number
  adjustment?: number
  warmupCap?: number
}

export interface RateLimitResult {
  allowedVolume: number
  reason: string
  requestedVolume: number
  adjustmentApplied: number
}

export async function enforceRateLimit(input: RateLimitInput): Promise<RateLimitResult> {
  const identity = await queryOne<{ remaining: string }>(
    `SELECT COALESCE(daily_limit - sent_today, 0)::text AS remaining
     FROM identities
     WHERE client_id = $1
     ORDER BY sent_today ASC
     LIMIT 1`,
    [input.clientId]
  )

  if (!identity) {
    return {
      allowedVolume: 0,
      requestedVolume: input.requestedVolume,
      adjustmentApplied: input.adjustment ?? 0,
      reason: 'no active identity available',
    }
  }

  const adjustment = Math.max(0, input.adjustment ?? 0)
  let allowedVolume = Math.max(0, Number(identity.remaining) - adjustment)
  if (typeof input.warmupCap === 'number') {
    allowedVolume = Math.min(allowedVolume, Math.max(0, input.warmupCap))
  }

  return {
    allowedVolume,
    requestedVolume: input.requestedVolume,
    adjustmentApplied: adjustment,
    reason:
      allowedVolume > 0
        ? `within limits after adjustment ${adjustment}`
        : 'rate limit reached after adjustment',
  }
}
