/**
 * DISTRIBUTION ENGINE
 *
 * Intelligently routes emails across healthy domains and inboxes
 *
 * Algorithm:
 * 1. Filter: Get healthy domains only (bounce < 5%, spam < 2%, status = active)
 * 2. Balance: Distribute across inboxes by load (sent today)
 * 3. Respect limits: Max 50 emails per inbox per day
 * 4. Rotate: Cycle through domains to prevent hotspots
 *
 * Example:
 *   Target domain: None specified, use auto-select
 *   Healthy domains: 10
 *   Inboxes per domain: 4
 *   Total capacity: 2,000 emails/day (40 inboxes × 50)
 *   Action: Select least-used inbox from healthiest domain
 */

import { query } from '@/lib/db'

export interface DistributionTarget {
  domainId: string
  domain: string
  inboxId: string
  inboxEmail: string
  emailsUsedToday: number
  emailsRemaining: number
  domainBounceRate: number
  domainSpamRate: number
  healthScore: number
}

export interface DistributionStrategy {
  strategy: 'round_robin' | 'least_loaded' | 'health_priority' | 'random'
  description: string
}

const STRATEGIES: Record<string, DistributionStrategy> = {
  round_robin: {
    strategy: 'round_robin',
    description: 'Cycle through inboxes in order',
  },
  least_loaded: {
    strategy: 'least_loaded',
    description: 'Use inbox with fewest emails sent today',
  },
  health_priority: {
    strategy: 'health_priority',
    description: 'Prioritize healthiest domain with least loaded inbox',
  },
  random: {
    strategy: 'random',
    description: 'Randomly select from available inboxes',
  },
}

/**
 * Select best inbox for sending
 */
export async function selectDistributionTarget(
  strategy: 'round_robin' | 'least_loaded' | 'health_priority' | 'random' = 'health_priority'
): Promise<DistributionTarget | null> {
  try {
    // Get healthy domains with their inboxes
    const inboxesResult = await query<any>(
      `SELECT 
        d.id as domain_id,
        d.domain,
        d.bounce_rate as "bounceRate",
        d.spam_rate as "spamRate",
        i.id as inbox_id,
        i.email,
        COUNT(CASE WHEN e.type = 'sent' AND e.created_at > NOW() - INTERVAL '1 day' THEN 1 END) as sent_today
      FROM domains d
      JOIN identities i ON i.domain_id = d.id
      LEFT JOIN events e ON e.from_inbox_id = i.id
      WHERE d.status = 'active' 
        AND d.bounce_rate < 0.05 
        AND d.spam_rate < 0.02
        AND i.status = 'active'
      GROUP BY d.id, d.domain, d.bounce_rate, d.spam_rate, i.id, i.email
      ORDER BY sent_today ASC`
    )

    if (inboxesResult.rows.length === 0) {
      return null // No healthy inboxes available
    }

    const inboxes = inboxesResult.rows.map((row: any) => ({
      domainId: row.domain_id,
      domain: row.domain,
      inboxId: row.inbox_id,
      inboxEmail: row.email,
      emailsUsedToday: parseInt(row.sent_today ?? 0, 10),
      emailsRemaining: 50 - (parseInt(row.sent_today ?? 0, 10) || 0),
      domainBounceRate: row.bounceRate,
      domainSpamRate: row.spamRate,
      healthScore: calculateHealthScore(row.bounceRate, row.spamRate),
    }))

    // Filter out fully used inboxes
    const available = inboxes.filter((i: any) => i.emailsRemaining > 0)

    if (available.length === 0) {
      return null // All inboxes at capacity
    }

    let selected: DistributionTarget | null = null

    switch (strategy) {
      case 'least_loaded':
        // Select inbox with fewest emails sent today
        selected = available.reduce((prev: any, curr: any) =>
          curr.emailsUsedToday < prev.emailsUsedToday ? curr : prev
        )
        break

      case 'health_priority':
        // Sort by health score (descending), then by emails used (ascending)
        available.sort((a: any, b: any) => {
          if (b.healthScore !== a.healthScore) {
            return b.healthScore - a.healthScore
          }
          return a.emailsUsedToday - b.emailsUsedToday
        })
        selected = available[0]
        break

      case 'round_robin':
        // Get last used inbox and select next
        const lastUsed = await getLastUsedInbox()
        if (lastUsed) {
          const lastIndex = available.findIndex((i: any) => i.inboxId === lastUsed)
          selected = available[(lastIndex + 1) % available.length]
        } else {
          selected = available[0]
        }
        break

      case 'random':
        // Random selection
        selected = available[Math.floor(Math.random() * available.length)]
        break

      default:
        selected = available[0]
    }

    // Log selection
    if (selected) {
      await logInboxUsage(selected.inboxId, strategy)
    }

    return selected
  } catch (error) {
    console.error('[Distribution] Error selecting target:', error)
    return null
  }
}

/**
 * Get multiple distribution targets for batch sending
 */
export async function selectMultipleDistributionTargets(
  count: number,
  strategy: 'round_robin' | 'least_loaded' | 'health_priority' | 'random' = 'health_priority'
): Promise<DistributionTarget[]> {
  const targets: DistributionTarget[] = []

  for (let i = 0; i < count; i++) {
    const target = await selectDistributionTarget(strategy)
    if (!target) {
      break // No more healthy inboxes
    }
    targets.push(target)
  }

  return targets
}

/**
 * Get inbox distribution report
 */
export async function getDistributionReport(): Promise<{
  totalInboxes: number
  healthyInboxes: number
  fullyUsedInboxes: number
  averageUtilization: number
  availableCapacity: number
  distributions: Array<{
    domain: string
    inbox: string
    sentToday: number
    remaining: number
    utilization: number
  }>
}> {
  try {
    const inboxesResult = await query<any>(
      `SELECT 
        d.domain,
        i.email,
        COUNT(CASE WHEN e.type = 'sent' AND e.created_at > NOW() - INTERVAL '1 day' THEN 1 END) as sent_today
      FROM domains d
      JOIN identities i ON i.domain_id = d.id
      LEFT JOIN events e ON e.from_inbox_id = i.id
      WHERE d.status = 'active' AND i.status = 'active'
      GROUP BY d.id, d.domain, i.id, i.email
      ORDER BY d.domain, i.email`
    )

    const distributions = inboxesResult.rows.map((row: any) => {
      const sent = parseInt(row.sent_today ?? 0, 10)
      return {
        domain: row.domain,
        inbox: row.email,
        sentToday: sent,
        remaining: Math.max(0, 50 - sent),
        utilization: (sent / 50) * 100,
      }
    })

    const totalInboxes = distributions.length
    const fullyUsed = distributions.filter((d) => d.remaining === 0).length
    const healthyInboxes = distributions.filter((d) => d.remaining > 0).length
    const totalSent = distributions.reduce((sum, d) => sum + d.sentToday, 0)
    const totalCapacity = totalInboxes * 50
    const averageUtilization = (totalSent / totalCapacity) * 100
    const availableCapacity = distributions.reduce((sum, d) => sum + d.remaining, 0)

    return {
      totalInboxes,
      healthyInboxes,
      fullyUsedInboxes: fullyUsed,
      averageUtilization,
      availableCapacity,
      distributions,
    }
  } catch (error) {
    console.error('[Distribution] Report error:', error)
    return {
      totalInboxes: 0,
      healthyInboxes: 0,
      fullyUsedInboxes: 0,
      averageUtilization: 0,
      availableCapacity: 0,
      distributions: [],
    }
  }
}

/**
 * Get last used inbox for round-robin
 */
async function getLastUsedInbox(): Promise<string | null> {
  try {
    const result = await query<{ inbox_id: string }>(
      `SELECT from_inbox_id as inbox_id FROM events 
      WHERE type = 'sent' 
      ORDER BY created_at DESC LIMIT 1`
    )

    return result.rows[0]?.inbox_id ?? null
  } catch (error) {
    return null
  }
}

/**
 * Log inbox usage for analytics
 */
async function logInboxUsage(inboxId: string, strategy: string): Promise<void> {
  try {
    await query(
      `INSERT INTO infrastructure_events (event_type, details)
      VALUES ($1, $2)`,
      ['inbox_selected', JSON.stringify({ inboxId, strategy, timestamp: new Date() })]
    )
  } catch (error) {
    // Non-critical logging, ignore errors
  }
}

/**
 * Calculate health score for distribution priority
 * Higher = healthier
 */
function calculateHealthScore(bounceRate: number, spamRate: number): number {
  return 100 - bounceRate * 1000 - spamRate * 1000
}

/**
 * Get distribution strategies
 */
export function getAvailableStrategies(): DistributionStrategy[] {
  return Object.values(STRATEGIES)
}
