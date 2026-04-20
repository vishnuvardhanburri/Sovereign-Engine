/**
 * CAPACITY ENGINE
 *
 * Calculates system capacity and auto-scales when needed
 *
 * Capacity = (active_healthy_domains × inboxes_per_domain × max_per_inbox)
 * = active_domains × 4 × 50
 * = active_domains × 200
 *
 * Example: 10 healthy domains = 2,000 capacity
 * To send 50,000/day:
 *   Need 250 healthy domains
 *   Need 1,000 inboxes
 */

import { query, transaction } from '@/lib/db'

export interface CapacityMetrics {
  targetDailyVolume: number
  currentCapacity: number
  healthyDomains: number
  totalInboxes: number
  inboxesPerDomain: number
  maxEmailsPerInbox: number
  capacityGapPercentage: number
  needsScaling: boolean
  domainsToAdd: number
  estimatedNewCapacity: number
}

export interface DomainMetrics {
  id: string
  domain: string
  status: 'active' | 'warming' | 'paused' | 'inactive'
  bounceRate: number
  spamRate: number
  isHealthy: boolean
  inboxCount: number
  sentToday: number
  capacity: number
}

/**
 * Calculate current system capacity
 */
export async function calculateCapacity(targetDailyVolume: number = 50000): Promise<CapacityMetrics> {
  const INBOXES_PER_DOMAIN = 4
  const MAX_EMAILS_PER_INBOX = 50

  // Get healthy domains
  const domainsResult = await query<any>(
    `SELECT 
      d.id,
      d.domain,
      d.status,
      d.bounce_rate as "bounceRate",
      d.spam_rate as "spamRate",
      COUNT(i.id) as inbox_count,
      COALESCE(SUM(CASE WHEN e.created_at > NOW() - INTERVAL '1 day' THEN 1 ELSE 0 END), 0) as sent_today
    FROM domains d
    LEFT JOIN identities i ON i.domain_id = d.id AND i.status = 'active'
    LEFT JOIN events e ON e.domain_id = d.id AND e.type = 'sent'
    GROUP BY d.id, d.domain, d.status, d.bounce_rate, d.spam_rate
    ORDER BY d.created_at DESC`
  )

  // Determine healthy domains (bounce < 5%, not paused, not inactive)
  const healthyDomains = domainsResult.rows.filter(
    (d: any) => d.bounceRate < 0.05 && d.status !== 'paused' && d.status !== 'inactive'
  )

  const totalInboxes = healthyDomains.reduce((sum: number, d: any) => sum + (d.inbox_count || 0), 0)

  // Calculate current capacity
  const currentCapacity = healthyDomains.length * INBOXES_PER_DOMAIN * MAX_EMAILS_PER_INBOX

  // Calculate gap
  const capacityGap = targetDailyVolume - currentCapacity
  const capacityGapPercentage = Math.max(0, (capacityGap / targetDailyVolume) * 100)
  const needsScaling = capacityGap > 0

  // Calculate domains to add (with 30% buffer)
  const domainsNeeded = Math.ceil(capacityGap / (INBOXES_PER_DOMAIN * MAX_EMAILS_PER_INBOX))
  const domainsToAddWithBuffer = Math.ceil(domainsNeeded * 1.3) // 30% buffer

  const estimatedNewCapacity = (healthyDomains.length + domainsToAddWithBuffer) * INBOXES_PER_DOMAIN * MAX_EMAILS_PER_INBOX

  return {
    targetDailyVolume,
    currentCapacity,
    healthyDomains: healthyDomains.length,
    totalInboxes,
    inboxesPerDomain: INBOXES_PER_DOMAIN,
    maxEmailsPerInbox: MAX_EMAILS_PER_INBOX,
    capacityGapPercentage,
    needsScaling,
    domainsToAdd: domainsToAddWithBuffer,
    estimatedNewCapacity,
  }
}

/**
 * Get capacity status for a specific domain
 */
export async function getDomainCapacity(domainId: string): Promise<DomainMetrics | null> {
  const INBOXES_PER_DOMAIN = 4
  const MAX_EMAILS_PER_INBOX = 50

  const result = await query<any>(
    `SELECT 
      d.id,
      d.domain,
      d.status,
      d.bounce_rate as "bounceRate",
      d.spam_rate as "spamRate",
      COUNT(i.id) as inbox_count,
      COALESCE(SUM(CASE WHEN e.created_at > NOW() - INTERVAL '1 day' THEN 1 ELSE 0 END), 0) as sent_today
    FROM domains d
    LEFT JOIN identities i ON i.domain_id = d.id AND i.status = 'active'
    LEFT JOIN events e ON e.domain_id = d.id AND e.type = 'sent'
    WHERE d.id = $1
    GROUP BY d.id, d.domain, d.status, d.bounce_rate, d.spam_rate`,
    [domainId]
  )

  if (result.rows.length === 0) {
    return null
  }

  const domain = result.rows[0]
  const isHealthy = domain.bounceRate < 0.05 && domain.status !== 'paused' && domain.status !== 'inactive'

  return {
    id: domain.id,
    domain: domain.domain,
    status: domain.status,
    bounceRate: domain.bounceRate,
    spamRate: domain.spamRate,
    isHealthy,
    inboxCount: domain.inbox_count || 0,
    sentToday: domain.sent_today || 0,
    capacity: isHealthy ? INBOXES_PER_DOMAIN * MAX_EMAILS_PER_INBOX : 0,
  }
}

/**
 * Get all healthy domain metrics
 */
export async function getAllHealthyDomains(): Promise<DomainMetrics[]> {
  const INBOXES_PER_DOMAIN = 4
  const MAX_EMAILS_PER_INBOX = 50

  const result = await query<any>(
    `SELECT 
      d.id,
      d.domain,
      d.status,
      d.bounce_rate as "bounceRate",
      d.spam_rate as "spamRate",
      COUNT(i.id) as inbox_count,
      COALESCE(SUM(CASE WHEN e.created_at > NOW() - INTERVAL '1 day' THEN 1 ELSE 0 END), 0) as sent_today
    FROM domains d
    LEFT JOIN identities i ON i.domain_id = d.id AND i.status = 'active'
    LEFT JOIN events e ON e.domain_id = d.id AND e.type = 'sent'
    WHERE d.bounce_rate < 0.05 AND d.status != 'paused' AND d.status != 'inactive'
    GROUP BY d.id, d.domain, d.status, d.bounce_rate, d.spam_rate
    ORDER BY d.bounce_rate ASC, d.created_at DESC`
  )

  return result.rows.map((d: any) => ({
    id: d.id,
    domain: d.domain,
    status: d.status,
    bounceRate: d.bounceRate,
    spamRate: d.spamRate,
    isHealthy: true,
    inboxCount: d.inbox_count || 0,
    sentToday: d.sent_today || 0,
    capacity: INBOXES_PER_DOMAIN * MAX_EMAILS_PER_INBOX,
  }))
}

/**
 * Check if system needs scaling
 */
export async function checkScalingNeeded(targetVolume: number = 50000): Promise<boolean> {
  const metrics = await calculateCapacity(targetVolume)
  return metrics.needsScaling
}

/**
 * Get capacity utilization percentage
 */
export async function getCapacityUtilization(): Promise<number> {
  const metrics = await calculateCapacity()
  // Get emails sent in last 24 hours
  const sentResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM events 
    WHERE type = 'sent' AND created_at > NOW() - INTERVAL '1 day'`
  )

  const emailsSent = parseInt(sentResult.rows[0]?.count ?? '0', 10)
  return Math.min(100, (emailsSent / metrics.currentCapacity) * 100)
}

/**
 * Calculate safe send volume (respects max per inbox)
 */
export async function calculateSafeSendVolume(): Promise<number> {
  const metrics = await calculateCapacity()
  // Return the minimum of: current capacity, or target - already sent
  const sentToday = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM events 
    WHERE type = 'sent' AND created_at > NOW() - INTERVAL '1 day'`
  )

  const emailsSentToday = parseInt(sentToday.rows[0]?.count ?? '0', 10)
  const remainingCapacity = metrics.currentCapacity - emailsSentToday

  // Never send more than target, never exceed capacity
  return Math.min(50000 - emailsSentToday, remainingCapacity)
}
