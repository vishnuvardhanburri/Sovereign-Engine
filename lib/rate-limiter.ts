import { query, queryOne } from '@/lib/db'
import {
  consumeToken,
  getDomainSentCount,
  getSentCount,
  incrementSentCount,
  initializeTokenBucket,
} from '@/lib/redis'
import { Domain, Identity } from '@/lib/db/types'

export interface RateLimitResult {
  allowed: boolean
  reason?: string
  wait_seconds?: number
  identity_id?: number
  domain_id?: number
}

/**
 * Select the best identity for sending based on:
 * 1. Domain must be active
 * 2. Identity must be active
 * 3. Must have capacity (sent_today < daily_limit)
 * 4. Ordered by domain health_score (highest first)
 * 5. Then by identity last_sent_at (oldest first)
 */
export async function selectBestIdentity(
  campaign_domain_id: number
): Promise<Identity | null> {
  const result = await queryOne<Identity & { domain: Domain }>(
    `SELECT i.*, d.id as domain_id, d.status as domain_status
     FROM identities i
     JOIN domains d ON i.domain_id = d.id
     WHERE i.domain_id = $1
     AND i.status = 'active'
     AND d.status = 'active'
     AND i.sent_today < i.daily_limit
     ORDER BY d.health_score DESC, i.last_sent_at ASC NULLS FIRST
     LIMIT 1`,
    [campaign_domain_id]
  )

  return result as Identity | null
}

/**
 * Check if an identity has capacity to send
 */
export async function checkCapacity(
  identity_id: number,
  domain_id: number
): Promise<RateLimitResult> {
  const identity = await queryOne<Identity>(
    'SELECT * FROM identities WHERE id = $1',
    [identity_id]
  )

  if (!identity) {
    return { allowed: false, reason: 'Identity not found' }
  }

  if (identity.status !== 'active') {
    return { allowed: false, reason: 'Identity is not active' }
  }

  // Check domain sent count (cached in Redis)
  const domainSent = await getDomainSentCount(domain_id)
  const domain = await queryOne<Domain>('SELECT * FROM domains WHERE id = $1', [
    domain_id,
  ])

  if (!domain) {
    return { allowed: false, reason: 'Domain not found' }
  }

  if (domainSent >= domain.daily_limit) {
    return {
      allowed: false,
      reason: `Domain daily limit reached (${domainSent}/${domain.daily_limit})`,
    }
  }

  if (identity.sent_today >= identity.daily_limit) {
    return {
      allowed: false,
      reason: `Identity daily limit reached (${identity.sent_today}/${identity.daily_limit})`,
    }
  }

  return { allowed: true, identity_id, domain_id }
}

/**
 * Check token bucket rate limiting with jitter
 * Returns whether the send is allowed and how long to wait if not
 */
export async function checkRateLimit(
  identity_id: number,
  refillInterval: number = 90 // 60-120s average
): Promise<RateLimitResult> {
  try {
    // Initialize bucket if doesn't exist
    const bucket = await consumeToken(identity_id, refillInterval)

    if (bucket.available) {
      return { allowed: true, identity_id }
    } else {
      return {
        allowed: false,
        reason: `Rate limit exceeded, wait ${bucket.wait_seconds}s`,
        wait_seconds: bucket.wait_seconds,
        identity_id,
      }
    }
  } catch (error) {
    console.error('[RateLimit] Error checking token bucket:', error)
    // Fail open - allow the send if we can't check Redis
    return { allowed: true, identity_id }
  }
}

/**
 * Combined check: capacity + rate limit
 */
export async function checkCanSend(
  identity_id: number,
  domain_id: number,
  refillInterval?: number
): Promise<RateLimitResult> {
  // Check capacity first
  const capacity = await checkCapacity(identity_id, domain_id)
  if (!capacity.allowed) {
    return capacity
  }

  // Then check rate limit
  const rateLimit = await checkRateLimit(identity_id, refillInterval)
  if (!rateLimit.allowed) {
    return rateLimit
  }

  return { allowed: true, identity_id, domain_id }
}

/**
 * Record a successful send and update counters
 */
export async function recordSend(
  identity_id: number,
  domain_id: number
): Promise<void> {
  try {
    // Update database
    await query(
      'UPDATE identities SET sent_today = sent_today + 1, last_sent_at = CURRENT_TIMESTAMP WHERE id = $1',
      [identity_id]
    )

    // Update cache
    await incrementSentCount(identity_id, domain_id)
  } catch (error) {
    console.error('[RateLimit] Error recording send:', error)
    throw error
  }
}

/**
 * Select best identity and validate it can send
 * Returns the identity if valid, null otherwise
 */
export async function selectAndValidateIdentity(
  domain_id: number,
  refillInterval?: number
): Promise<Identity | null> {
  const identity = await selectBestIdentity(domain_id)
  if (!identity) {
    return null
  }

  const canSend = await checkCanSend(
    identity.id,
    domain_id,
    refillInterval
  )

  if (!canSend.allowed) {
    console.log(`[RateLimit] Cannot send with identity ${identity.id}: ${canSend.reason}`)
    return null
  }

  return identity
}

/**
 * Reset daily counters (called by cron job)
 */
export async function resetDailyCounters(): Promise<void> {
  // Reset identities sent_today
  await query('UPDATE identities SET sent_today = 0, updated_at = CURRENT_TIMESTAMP')

  // Reset domains sent_today
  await query('UPDATE domains SET sent_today = 0, updated_at = CURRENT_TIMESTAMP')

  console.log('[RateLimit] Daily counters reset')
}

/**
 * Scale domain limits based on health score (called by cron job)
 */
export async function scaleDomainLimits(): Promise<void> {
  const results = await query<Domain>(
    `SELECT * FROM domains WHERE status = 'active'`
  )

  for (const domain of results.rows) {
    let newLimit = domain.daily_limit

    if (domain.health_score >= 90) {
      // Scale up: increase by 10%, up to 500
      newLimit = Math.min(500, Math.ceil(domain.daily_limit * 1.1))
    } else if (domain.health_score < 80) {
      // Scale down: decrease by 5%
      newLimit = Math.max(50, Math.floor(domain.daily_limit * 0.95))
    }

    if (newLimit !== domain.daily_limit) {
      await query('UPDATE domains SET daily_limit = $1 WHERE id = $2', [
        newLimit,
        domain.id,
      ])
      console.log(
        `[RateLimit] Scaled domain ${domain.domain}: ${domain.daily_limit} → ${newLimit}`
      )
    }
  }
}
