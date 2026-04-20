/**
 * DOMAIN HEALTH SYSTEM
 *
 * Monitors domain reputation and automatically adjusts sending
 *
 * Metrics:
 * - Bounce Rate: % of emails bounced (limit: <5%)
 * - Spam Rate: % of emails marked as spam (limit: <2%)
 * - Sending Volume: Respect per-inbox limits
 *
 * Actions:
 * - Pause domain if bounce rate > 5% or spam rate > 2%
 * - Resume domain after 24h cooling off period
 * - Reduce sending if close to limits
 * - Alert if trend is negative
 */

import { query, type QueryResult } from '@/lib/db'

export interface DomainHealth {
  domainId: string
  domain: string
  bounceRate: number
  spamRate: number
  bounceCount24h: number
  spamCount24h: number
  sentCount24h: number
  unsubscribeCount24h: number
  status: 'active' | 'warming' | 'paused' | 'recovering'
  isPaused: boolean
  isPausedUntil?: Date
  issues: string[]
  score: number // 0-100
  recommendation: string
}

export interface HealthAlert {
  severity: 'info' | 'warning' | 'critical'
  domain: string
  message: string
  metrics: {
    bounceRate: number
    spamRate: number
  }
  action: string
  timestamp: Date
}

/**
 * Calculate health score for a domain
 * Score = 100 - (bounce_rate_pct + spam_rate_pct) - volume_factor
 * 100 = perfect, 0 = critical
 */
export async function calculateDomainHealth(domainId: string): Promise<DomainHealth | null> {
  try {
    // Get domain and recent stats
    const domainResult = await query<any>(
      `SELECT 
        d.id,
        d.domain,
        d.status,
        d.bounce_rate as "bounceRate",
        d.spam_rate as "spamRate",
        d.paused_until as "pausedUntil"
      FROM domains d
      WHERE d.id = $1`,
      [domainId]
    )

    if (domainResult.rows.length === 0) {
      return null
    }

    const domain = domainResult.rows[0]

    // Get 24h stats
    const statsResult = await query<any>(
      `SELECT
        COUNT(CASE WHEN type = 'bounce' THEN 1 END) as bounce_count,
        COUNT(CASE WHEN type = 'spam' THEN 1 END) as spam_count,
        COUNT(CASE WHEN type = 'sent' THEN 1 END) as sent_count,
        COUNT(CASE WHEN type = 'unsubscribe' THEN 1 END) as unsubscribe_count
      FROM events
      WHERE domain_id = $1 AND created_at > NOW() - INTERVAL '1 day'`,
      [domainId]
    )

    const stats = statsResult.rows[0] || {
      bounce_count: 0,
      spam_count: 0,
      sent_count: 0,
      unsubscribe_count: 0,
    }

    const bounceCount = parseInt(stats.bounce_count ?? 0, 10)
    const spamCount = parseInt(stats.spam_count ?? 0, 10)
    const sentCount = parseInt(stats.sent_count ?? 0, 10)
    const unsubscribeCount = parseInt(stats.unsubscribe_count ?? 0, 10)

    // Calculate rates
    const bounceRate = sentCount > 0 ? bounceCount / sentCount : 0
    const spamRate = sentCount > 0 ? spamCount / sentCount : 0

    // Determine issues
    const issues: string[] = []
    if (bounceRate > 0.05) issues.push(`High bounce rate: ${(bounceRate * 100).toFixed(1)}%`)
    if (spamRate > 0.02) issues.push(`High spam rate: ${(spamRate * 100).toFixed(1)}%`)
    if (domain.pausedUntil && new Date(domain.pausedUntil) > new Date())
      issues.push('Domain paused for cooling')

    // Calculate score (0-100)
    let score = 100
    score -= Math.min(bounceRate * 1000, 40) // Max -40 for bounce
    score -= Math.min(spamRate * 1000, 25) // Max -25 for spam
    score -= Math.min(sentCount / 10000, 10) // Max -10 for high volume
    score = Math.max(0, score)

    // Determine status
    let status = domain.status
    if (domain.pausedUntil && new Date(domain.pausedUntil) > new Date()) {
      status = 'paused'
    } else if (bounceRate > 0.05 || spamRate > 0.02) {
      status = 'paused'
    } else if (domain.status === 'warming') {
      status = 'warming'
    } else if (status !== 'active') {
      status = 'recovering'
    }

    // Recommendation
    let recommendation = 'Monitor'
    if (issues.length > 0) {
      if (bounceRate > 0.05 || spamRate > 0.02) {
        recommendation = 'PAUSE SENDING - High bounce/spam rate'
      } else if (score < 30) {
        recommendation = 'Reduce sending volume'
      }
    } else if (domain.status === 'warming') {
      recommendation = 'Continue warmup schedule'
    } else if (score > 80) {
      recommendation = 'Can increase sending volume'
    }

    return {
      domainId,
      domain: domain.domain,
      bounceRate,
      spamRate,
      bounceCount24h: bounceCount,
      spamCount24h: spamCount,
      sentCount24h: sentCount,
      unsubscribeCount24h: unsubscribeCount,
      status,
      isPaused: status === 'paused',
      isPausedUntil: domain.pausedUntil ? new Date(domain.pausedUntil) : undefined,
      issues,
      score,
      recommendation,
    }
  } catch (error) {
    console.error('[DomainHealth] Error calculating health:', error)
    return null
  }
}

/**
 * Get health for all domains
 */
export async function getAllDomainsHealth(): Promise<DomainHealth[]> {
  try {
    const domainsResult = await query<any>(
      `SELECT id FROM domains WHERE status != 'inactive' ORDER BY bounce_rate ASC`
    )

    const health: DomainHealth[] = []

    for (const row of domainsResult.rows) {
      const domainHealth = await calculateDomainHealth(row.id)
      if (domainHealth) {
        health.push(domainHealth)
      }
    }

    return health
  } catch (error) {
    console.error('[DomainHealth] Error getting all health:', error)
    return []
  }
}

/**
 * Check health and take actions if needed
 */
export async function checkAndActOnDomainHealth(domainId: string): Promise<HealthAlert[]> {
  const alerts: HealthAlert[] = []

  try {
    const health = await calculateDomainHealth(domainId)
    if (!health) return alerts

    // Check bounce rate
    if (health.bounceRate > 0.05 && !health.isPaused) {
      alerts.push({
        severity: 'critical',
        domain: health.domain,
        message: `Bounce rate ${(health.bounceRate * 100).toFixed(1)}% exceeds limit`,
        metrics: {
          bounceRate: health.bounceRate,
          spamRate: health.spamRate,
        },
        action: 'Pausing domain for 24h',
        timestamp: new Date(),
      })

      // Pause domain
      await pauseDomain(domainId, 24)
    }

    // Check spam rate
    if (health.spamRate > 0.02 && !health.isPaused) {
      alerts.push({
        severity: 'critical',
        domain: health.domain,
        message: `Spam rate ${(health.spamRate * 100).toFixed(1)}% exceeds limit`,
        metrics: {
          bounceRate: health.bounceRate,
          spamRate: health.spamRate,
        },
        action: 'Pausing domain for 24h',
        timestamp: new Date(),
      })

      // Pause domain
      await pauseDomain(domainId, 24)
    }

    // Warn if approaching limits
    if (health.bounceRate > 0.04) {
      alerts.push({
        severity: 'warning',
        domain: health.domain,
        message: `Bounce rate ${(health.bounceRate * 100).toFixed(1)}% approaching limit`,
        metrics: {
          bounceRate: health.bounceRate,
          spamRate: health.spamRate,
        },
        action: 'Monitor closely',
        timestamp: new Date(),
      })
    }

    if (health.spamRate > 0.015) {
      alerts.push({
        severity: 'warning',
        domain: health.domain,
        message: `Spam rate ${(health.spamRate * 100).toFixed(1)}% approaching limit`,
        metrics: {
          bounceRate: health.bounceRate,
          spamRate: health.spamRate,
        },
        action: 'Reduce sending volume or improve list quality',
        timestamp: new Date(),
      })
    }

    // Info: health improving
    if (health.score > 90 && health.status !== 'active') {
      alerts.push({
        severity: 'info',
        domain: health.domain,
        message: `Health improving, ready to resume`,
        metrics: {
          bounceRate: health.bounceRate,
          spamRate: health.spamRate,
        },
        action: 'Can resume sending',
        timestamp: new Date(),
      })
    }

    return alerts
  } catch (error) {
    console.error('[DomainHealth] Error checking health:', error)
    return alerts
  }
}

/**
 * Pause a domain for N hours
 */
export async function pauseDomain(domainId: string, hoursToWait: number = 24): Promise<boolean> {
  try {
    const pauseUntil = new Date(Date.now() + hoursToWait * 60 * 60 * 1000)

    const result = await query(
      `UPDATE domains SET status = 'paused', paused_until = $1 WHERE id = $2`,
      [pauseUntil, domainId]
    )

    if (result.rowCount > 0) {
      // Log the action
      await query(
        `INSERT INTO infrastructure_events (event_type, domain_id, details)
        VALUES ($1, $2, $3)`,
        ['domain_paused', domainId, JSON.stringify({ reason: 'health_check', hours: hoursToWait })]
      )
    }

    return result.rowCount > 0
  } catch (error) {
    console.error('[DomainHealth] Pause error:', error)
    return false
  }
}

/**
 * Resume a paused domain
 */
export async function resumeDomain(domainId: string): Promise<boolean> {
  try {
    const result = await query(
      `UPDATE domains SET status = 'active', paused_until = NULL WHERE id = $1`,
      [domainId]
    )

    if (result.rowCount > 0) {
      await query(
        `INSERT INTO infrastructure_events (event_type, domain_id, details)
        VALUES ($1, $2, $3)`,
        ['domain_resumed', domainId, JSON.stringify({ reason: 'health_recovery' })]
      )
    }

    return result.rowCount > 0
  } catch (error) {
    console.error('[DomainHealth] Resume error:', error)
    return false
  }
}

/**
 * Auto-resume domains that have cooled off
 */
export async function autoResumeDomains(): Promise<string[]> {
  try {
    const resumedDomains: string[] = []

    const pausedResult = await query<any>(
      `SELECT id FROM domains 
      WHERE status = 'paused' AND paused_until IS NOT NULL AND paused_until <= NOW()`
    )

    for (const row of pausedResult.rows) {
      const success = await resumeDomain(row.id)
      if (success) {
        resumedDomains.push(row.id)
      }
    }

    return resumedDomains
  } catch (error) {
    console.error('[DomainHealth] Auto-resume error:', error)
    return []
  }
}
