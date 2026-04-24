/**
 * INFRASTRUCTURE ANALYTICS & INSIGHTS
 *
 * Advanced analytics and insights generation for autonomous infrastructure
 * Generates recommendations based on collected metrics
 */

import { query } from '@/lib/db'

export interface InfrastructureMetrics {
  timestamp: Date
  domainCount: number
  healthyDomains: number
  inboxCount: number
  totalCapacity: number
  usedCapacity: number
  capacityUtilization: number
  averageBounceRate: number
  averageSpamRate: number
  emailsSent24h: number
  avgDeliveryTime: number
  uptime: number
}

export interface DomainMetrics {
  domainId: string
  domain: string
  inboxCount: number
  emailsSent24h: number
  bounceRate: number
  spamRate: number
  avgDeliveryTime: number
  health: 'excellent' | 'good' | 'fair' | 'poor' | 'critical'
  paused: boolean
}

export interface InfrastructureRecommendation {
  id: string
  category: string
  priority: 'high' | 'medium' | 'low'
  title: string
  description: string
  action: string
  estimatedImpact: string
  confidence: number
}

export interface PerformanceAnalysis {
  period: string
  peakHour: number
  avgLoad: number
  maxLoad: number
  bottlenecks: string[]
  insights: string[]
  recommendations: InfrastructureRecommendation[]
}

/**
 * Get infrastructure metrics snapshot
 */
export async function getMetricsSnapshot(): Promise<InfrastructureMetrics> {
  try {
    const [domainsRes, inboxesRes, eventsRes, deliveryRes] = await Promise.all([
      query<any>(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN status = 'active' THEN 1 END) as healthy,
          SUM(bounce_rate) as total_bounce_rate,
          SUM(spam_rate) as total_spam_rate
        FROM domains
      `),
      query<any>(`
        SELECT COUNT(*) as total FROM identities WHERE status = 'active'
      `),
      query<any>(`
        SELECT 
          COUNT(CASE WHEN type = 'sent' AND created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as sent_24h,
          COUNT(CASE WHEN type = 'delivery_failure' THEN 1 END) as failures
        FROM events
      `),
      query<any>(`
        SELECT AVG(EXTRACT(EPOCH FROM (created_at - delivered_at))) as avg_delivery_seconds
        FROM events
        WHERE type = 'delivered'
        AND created_at > NOW() - INTERVAL '24 hours'
      `),
    ])

    const domainCount = parseInt(domainsRes.rows[0]?.total ?? '0', 10)
    const healthyDomains = parseInt(domainsRes.rows[0]?.healthy ?? '0', 10)
    const inboxCount = parseInt(inboxesRes.rows[0]?.total ?? '0', 10)
    const emailsSent24h = parseInt(eventsRes.rows[0]?.sent_24h ?? '0', 10)
    const avgDeliveryTime =
      parseInt(deliveryRes.rows[0]?.avg_delivery_seconds ?? '0', 10) / 1000

    const totalCapacity = inboxCount * 50 // 50 emails per inbox per day
    const usedCapacity = emailsSent24h
    const capacityUtilization = totalCapacity > 0 ? (usedCapacity / totalCapacity) * 100 : 0

    const avgBounceRate =
      domainCount > 0
        ? parseFloat(domainsRes.rows[0]?.total_bounce_rate ?? '0') / domainCount
        : 0

    const avgSpamRate =
      domainCount > 0
        ? parseFloat(domainsRes.rows[0]?.total_spam_rate ?? '0') / domainCount
        : 0

    return {
      timestamp: new Date(),
      domainCount,
      healthyDomains,
      inboxCount,
      totalCapacity,
      usedCapacity,
      capacityUtilization,
      averageBounceRate: avgBounceRate,
      averageSpamRate: avgSpamRate,
      emailsSent24h,
      avgDeliveryTime,
      uptime: healthyDomains > 0 ? (healthyDomains / domainCount) * 100 : 0,
    }
  } catch (error) {
    console.error('[Analytics] Metrics snapshot error:', error)
    throw error
  }
}

/**
 * Get per-domain analytics
 */
export async function getDomainAnalytics(): Promise<DomainMetrics[]> {
  try {
    const result = await query<any>(`
      SELECT 
        d.id,
        d.domain,
        COUNT(i.id) as inbox_count,
        COUNT(CASE WHEN e.type = 'sent' AND e.created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as emails_sent_24h,
        d.bounce_rate,
        d.spam_rate,
        EXTRACT(EPOCH FROM AVG(CASE WHEN e.type = 'delivered' THEN (e.created_at - e.delivered_at) END)) as avg_delivery_seconds,
        d.status,
        d.paused
      FROM domains d
      LEFT JOIN identities i ON i.domain_id = d.id
      LEFT JOIN events e ON e.domain_id = d.id AND e.created_at > NOW() - INTERVAL '24 hours'
      GROUP BY d.id, d.domain, d.bounce_rate, d.spam_rate, d.status, d.paused
      ORDER BY emails_sent_24h DESC
    `)

    return result.rows.map((row) => ({
      domainId: row.id,
      domain: row.domain,
      inboxCount: parseInt(row.inbox_count ?? '0', 10),
      emailsSent24h: parseInt(row.emails_sent_24h ?? '0', 10),
      bounceRate: parseFloat(row.bounce_rate ?? '0'),
      spamRate: parseFloat(row.spam_rate ?? '0'),
      avgDeliveryTime: parseFloat(row.avg_delivery_seconds ?? '0') / 1000,
      health: classifyDomainHealth(
        parseFloat(row.bounce_rate ?? '0'),
        parseFloat(row.spam_rate ?? '0'),
        row.status === 'active'
      ),
      paused: row.paused === true,
    }))
  } catch (error) {
    console.error('[Analytics] Domain analytics error:', error)
    throw error
  }
}

/**
 * Classify domain health based on metrics
 */
function classifyDomainHealth(
  bounceRate: number,
  spamRate: number,
  isActive: boolean
): 'excellent' | 'good' | 'fair' | 'poor' | 'critical' {
  if (!isActive) return 'critical'
  if (bounceRate > 0.05 || spamRate > 0.02) return 'critical'
  if (bounceRate > 0.04 || spamRate > 0.015) return 'poor'
  if (bounceRate > 0.03 || spamRate > 0.01) return 'fair'
  if (bounceRate > 0.02 || spamRate > 0.005) return 'good'
  return 'excellent'
}

/**
 * Generate infrastructure recommendations
 */
export async function generateRecommendations(): Promise<InfrastructureRecommendation[]> {
  const recommendations: InfrastructureRecommendation[] = []

  try {
    const metrics = await getMetricsSnapshot()
    const domainMetrics = await getDomainAnalytics()

    // Recommendation: Scale capacity
    if (metrics.capacityUtilization > 75) {
      recommendations.push({
        id: `rec-${Date.now()}-1`,
        category: 'scaling',
        priority: metrics.capacityUtilization > 90 ? 'high' : 'medium',
        title: 'Scale Infrastructure Capacity',
        description: `Current capacity utilization is ${Math.round(metrics.capacityUtilization)}%`,
        action: 'Provision new domains or inboxes to increase capacity buffer',
        estimatedImpact: `Increase capacity to ${Math.round(metrics.usedCapacity * 1.5)} daily emails`,
        confidence: 0.95,
      })
    }

    // Recommendation: Unhealthy domains
    const unhealthyDomains = domainMetrics.filter((d) =>
      ['poor', 'critical'].includes(d.health)
    )
    if (unhealthyDomains.length > 0) {
      recommendations.push({
        id: `rec-${Date.now()}-2`,
        category: 'health',
        priority: 'high',
        title: `${unhealthyDomains.length} Domains Need Attention`,
        description: `${unhealthyDomains.map((d) => d.domain).join(', ')} have degraded metrics`,
        action: 'Review bounce/spam rates and consider IP warmup or deliverability audit',
        estimatedImpact: 'Restore domain health and reliability',
        confidence: 0.9,
      })
    }

    // Recommendation: Distribution optimization
    const distribution = calculateOptimalDistribution(domainMetrics)
    const currentVariance = calculateLoadVariance(domainMetrics)
    if (currentVariance > distribution.idealVariance) {
      recommendations.push({
        id: `rec-${Date.now()}-3`,
        category: 'optimization',
        priority: 'medium',
        title: 'Optimize Email Distribution',
        description: 'Email load is unevenly distributed across domains',
        action: 'Rebalance using least-loaded or health-priority strategy',
        estimatedImpact: 'Better resource utilization and domain health',
        confidence: 0.85,
      })
    }

    // Recommendation: Warmup scheduling
    const coldDomains = domainMetrics.filter((d) => d.emailsSent24h < 10)
    if (coldDomains.length > 0) {
      recommendations.push({
        id: `rec-${Date.now()}-4`,
        category: 'warmup',
        priority: 'medium',
        title: `Schedule Warmup for ${coldDomains.length} New Domains`,
        description: 'New domains detected with minimal sending history',
        action: 'Start guided warmup schedule to build sender reputation',
        estimatedImpact: 'Faster ramp-up and better deliverability',
        confidence: 0.88,
      })
    }

    // Recommendation: Monitoring gaps
    if (metrics.domainCount === 0) {
      recommendations.push({
        id: `rec-${Date.now()}-5`,
        category: 'setup',
        priority: 'high',
        title: 'No Active Domains Found',
        description: 'Infrastructure has no domains provisioned',
        action: 'Add sending domains via domain manager',
        estimatedImpact: 'Enable email sending capability',
        confidence: 1.0,
      })
    }

    // Recommendation: Delivery optimization
    if (metrics.avgDeliveryTime > 30) {
      recommendations.push({
        id: `rec-${Date.now()}-6`,
        category: 'performance',
        priority: 'medium',
        title: 'Improve Email Delivery Speed',
        description: `Average delivery time is ${metrics.avgDeliveryTime.toFixed(1)}s`,
        action: 'Check mail server load and consider parallelization',
        estimatedImpact: 'Faster user experience and better throughput',
        confidence: 0.75,
      })
    }
  } catch (error) {
    console.error('[Analytics] Recommendation error:', error)
  }

  return recommendations.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 }
    return priorityOrder[a.priority] - priorityOrder[b.priority]
  })
}

/**
 * Analyze performance patterns
 */
export async function analyzePerformancePatterns(): Promise<PerformanceAnalysis> {
  try {
    const hourlyData = await query<any>(`
      SELECT 
        EXTRACT(HOUR FROM created_at) as hour,
        COUNT(*) as count
      FROM events
      WHERE type = 'sent'
      AND created_at > NOW() - INTERVAL '24 hours'
      GROUP BY EXTRACT(HOUR FROM created_at)
      ORDER BY hour
    `)

    const hours = hourlyData.rows.map((r) => ({
      hour: parseInt(r.hour ?? '0', 10),
      count: parseInt(r.count ?? '0', 10),
    }))

    const peakHour = hours.length
      ? hours.reduce((max, h) => (h.count > max.count ? h : max)).hour
      : 0

    const totalEmails = hours.reduce((sum, h) => sum + h.count, 0)
    const avgLoad = totalEmails / 24
    const maxLoad = Math.max(...hours.map((h) => h.count), 0)

    const bottlenecks: string[] = []
    if (maxLoad > avgLoad * 2) {
      bottlenecks.push(
        `Peak load ${Math.round(maxLoad / avgLoad)}x average at hour ${peakHour}`
      )
    }

    const insights: string[] = []
    insights.push(
      `Peak sending hour: ${peakHour}:00 with ${peakHour === 0 ? '24' : Math.max(0, peakHour)}:00 UTC`
    )
    insights.push(
      `Average hourly throughput: ${Math.round(avgLoad)} emails/hour`
    )
    insights.push(
      `24-hour total: ${totalEmails} emails sent`
    )

    const recommendations = await generateRecommendations()

    return {
      period: '24 hours',
      peakHour,
      avgLoad: Math.round(avgLoad),
      maxLoad,
      bottlenecks,
      insights,
      recommendations,
    }
  } catch (error) {
    console.error('[Analytics] Performance analysis error:', error)
    throw error
  }
}

/**
 * Calculate optimal load distribution
 */
function calculateOptimalDistribution(domains: DomainMetrics[]) {
  if (domains.length === 0) return { idealVariance: 0, idealLoad: 0 }

  const totalLoad = domains.reduce((sum, d) => sum + d.emailsSent24h, 0)
  const idealLoad = totalLoad / domains.length

  return {
    idealVariance: 0.15, // Allow 15% variance
    idealLoad,
  }
}

/**
 * Calculate current load variance
 */
function calculateLoadVariance(domains: DomainMetrics[]): number {
  if (domains.length < 2) return 0

  const avgLoad =
    domains.reduce((sum, d) => sum + d.emailsSent24h, 0) / domains.length
  const variance =
    domains.reduce((sum, d) => sum + Math.pow(d.emailsSent24h - avgLoad, 2), 0) /
    domains.length

  return Math.sqrt(variance) / avgLoad
}

/**
 * Export analytics report
 */
export async function generateReport(): Promise<string> {
  try {
    const metrics = await getMetricsSnapshot()
    const domains = await getDomainAnalytics()
    const perf = await analyzePerformancePatterns()
    const recs = await generateRecommendations()

    const report = `
# Infrastructure Analytics Report
Generated: ${new Date().toISOString()}

## Summary
- Domains: ${metrics.domainCount} (${metrics.healthyDomains} healthy)
- Inboxes: ${metrics.inboxCount}
- Capacity: ${Math.round(metrics.capacityUtilization)}% utilized
- Uptime: ${metrics.uptime.toFixed(1)}%

## Performance
- 24h Volume: ${metrics.emailsSent24h} emails
- Avg Delivery Time: ${metrics.avgDeliveryTime.toFixed(1)}s
- Peak Hour: ${perf.peakHour}:00 UTC
- Avg Bounce Rate: ${(metrics.averageBounceRate * 100).toFixed(2)}%
- Avg Spam Rate: ${(metrics.averageSpamRate * 100).toFixed(2)}%

## Top Domains
${domains
  .slice(0, 5)
  .map(
    (d) =>
      `- ${d.domain}: ${d.emailsSent24h} emails, ${(d.bounceRate * 100).toFixed(2)}% bounce rate`
  )
  .join('\n')}

## Recommendations
${recs
  .slice(0, 5)
  .map(
    (r) =>
      `- [${r.priority.toUpperCase()}] ${r.title}\n  ${r.description}\n  Action: ${r.action}`
  )
  .join('\n\n')}

## Insights
${perf.insights.map((i) => `- ${i}`).join('\n')}
    `

    return report
  } catch (error) {
    console.error('[Analytics] Report generation error:', error)
    throw error
  }
}
