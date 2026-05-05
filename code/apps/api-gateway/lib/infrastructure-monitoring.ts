/**
 * INFRASTRUCTURE MONITORING & ALERTING
 *
 * Background monitoring service for the autonomous infrastructure system
 * Detects critical conditions and triggers alerts
 */

import { coordinator } from '@/lib/infrastructure'
import { query } from '@/lib/db'

export interface AlertConfig {
  capacityCritical: number // %
  capacityWarning: number // %
  healthDegraded: boolean
  failuresPerHour: number
  bounceRateCritical: number // %
  spamRateCritical: number // %
}

export interface Alert {
  id: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  message: string
  component: string
  timestamp: Date
  resolved: boolean
  metadata?: Record<string, any>
}

const DEFAULT_ALERT_CONFIG: AlertConfig = {
  capacityCritical: 90,
  capacityWarning: 75,
  healthDegraded: true,
  failuresPerHour: 10,
  bounceRateCritical: 0.05,
  spamRateCritical: 0.02,
}

let alerts: Alert[] = []
let isMonitoring = false

/**
 * Start monitoring infrastructure
 */
export async function startMonitoring(config: Partial<AlertConfig> = {}) {
  const finalConfig = { ...DEFAULT_ALERT_CONFIG, ...config }

  if (isMonitoring) {
    console.log('[Monitor] Already monitoring')
    return
  }

  isMonitoring = true
  console.log('[Monitor] Starting infrastructure monitoring...')

  // Main monitoring loop (every 30 seconds)
  setInterval(async () => {
    try {
      await runHealthCheck(finalConfig)
    } catch (error) {
      console.error('[Monitor] Health check error:', error)
    }
  }, 30000)

  // Detailed analysis loop (every 5 minutes)
  setInterval(async () => {
    try {
      await runDetailedAnalysis(finalConfig)
    } catch (error) {
      console.error('[Monitor] Analysis error:', error)
    }
  }, 5 * 60 * 1000)

  console.log('[Monitor] Infrastructure monitoring started')
}

/**
 * Run health check and alert on issues
 */
async function runHealthCheck(config: AlertConfig) {
  try {
    const state = await coordinator.getState()

    // Alert: Capacity critical
    if (state.capacityUtilization > config.capacityCritical) {
      addAlert({
        severity: 'critical',
        title: 'Capacity Critical',
        message: `Capacity utilization is ${Math.round(state.capacityUtilization)}% (critical: ${config.capacityCritical}%)`,
        component: 'capacity',
        metadata: {
          utilization: state.capacityUtilization,
          current: state.currentCapacity,
          target: state.targetCapacity,
        },
      })
    } else if (state.capacityUtilization > config.capacityWarning) {
      // Alert: Capacity warning
      addAlert({
        severity: 'warning',
        title: 'Capacity High',
        message: `Capacity utilization is ${Math.round(state.capacityUtilization)}% (warning: ${config.capacityWarning}%)`,
        component: 'capacity',
        metadata: {
          utilization: state.capacityUtilization,
        },
      })
    }

    // Alert: System health degraded
    if (config.healthDegraded && !state.systemHealth.isHealthy) {
      addAlert({
        severity: 'warning',
        title: 'System Degraded',
        message: `${state.systemHealth.issues.length} infrastructure issue(s) detected`,
        component: 'health',
        metadata: {
          issues: state.systemHealth.issues,
          issueCount: state.systemHealth.issues.length,
        },
      })
    }

    // Alert: System paused
    if (state.isPaused) {
      addAlert({
        severity: 'critical',
        title: 'Sending Paused',
        message: 'Email sending infrastructure is paused',
        component: 'system',
      })
    }

    // Alert: Low capacity per domain
    // In local/dev environments, it's common to have zero domains configured; treat that as setup info.
    if (state.healthyDomains === 0) {
      if (state.totalDomains === 0) {
        addAlert({
          severity: 'info',
          title: 'No Domains Configured',
          message: 'Add at least one domain to enable sending capacity and health checks.',
          component: 'domains',
        })
      } else {
        addAlert({
          severity: 'critical',
          title: 'No Healthy Domains',
          message: 'No healthy domains available for sending',
          component: 'domains',
        })
      }
    }
  } catch (error) {
    console.error('[Monitor] Health check failed:', error)
  }
}

/**
 * Run detailed analysis and generate actionable alerts
 */
async function runDetailedAnalysis(config: AlertConfig) {
  try {
    // Check domain health
    const domainsResult = await query<any>(`
      SELECT 
        d.id,
        d.domain,
        d.bounce_rate as "bounceRate",
        d.spam_rate as "spamRate",
        COUNT(CASE WHEN e.type = 'sent' AND e.created_at > NOW() - INTERVAL '1 day' THEN 1 END) as sent_24h,
        COUNT(CASE WHEN e.type = 'bounce' AND e.created_at > NOW() - INTERVAL '1 hour' THEN 1 END) as bounces_1h
      FROM domains d
      LEFT JOIN events e ON e.domain_id = d.id
      WHERE d.status = 'active'
      GROUP BY d.id, d.domain, d.bounce_rate, d.spam_rate
    `)

    for (const domain of domainsResult.rows) {
      // Alert: Bounce rate critical
      if (domain.bounceRate >= config.bounceRateCritical) {
        addAlert({
          severity: 'critical',
          title: `${domain.domain}: High Bounce Rate`,
          message: `Bounce rate ${(domain.bounceRate * 100).toFixed(2)}% exceeds critical threshold`,
          component: 'domain',
          metadata: {
            domain: domain.domain,
            bounceRate: domain.bounceRate,
          },
        })
      }

      // Alert: Spam rate critical
      if (domain.spamRate >= config.spamRateCritical) {
        addAlert({
          severity: 'critical',
          title: `${domain.domain}: High Spam Rate`,
          message: `Spam rate ${(domain.spamRate * 100).toFixed(2)}% exceeds critical threshold`,
          component: 'domain',
          metadata: {
            domain: domain.domain,
            spamRate: domain.spamRate,
          },
        })
      }

      // Alert: Bounce spike
      if (domain.bounces_1h > 10) {
        addAlert({
          severity: 'warning',
          title: `${domain.domain}: Bounce Spike`,
          message: `${domain.bounces_1h} bounces in last hour`,
          component: 'domain',
          metadata: {
            domain: domain.domain,
            bounces_1h: domain.bounces_1h,
          },
        })
      }
    }

    // Check failure rate
    const failureResult = await query<any>(`
      SELECT COUNT(*) as failure_count
      FROM infrastructure_events
      WHERE event_type LIKE '%failure%'
      AND created_at > NOW() - INTERVAL '1 hour'
    `)

    const failureCount = parseInt(failureResult.rows[0]?.failure_count ?? '0', 10)
    if (failureCount > config.failuresPerHour) {
      addAlert({
        severity: 'warning',
        title: 'High Failure Rate',
        message: `${failureCount} failures in last hour (warning: ${config.failuresPerHour})`,
        component: 'failures',
        metadata: {
          failureCount,
          failureThreshold: config.failuresPerHour,
        },
      })
    }

    // Check temp unavailable inboxes
    const unavailableResult = await query<any>(`
      SELECT COUNT(*) as count
      FROM identities
      WHERE unavailable_until > NOW()
    `)

    const unavailableCount = parseInt(unavailableResult.rows[0]?.count ?? '0', 10)
    if (unavailableCount > 5) {
      addAlert({
        severity: 'info',
        title: 'Inboxes Cooling Off',
        message: `${unavailableCount} inboxes temporarily unavailable for recovery`,
        component: 'inboxes',
        metadata: {
          unavailableCount,
        },
      })
    }
  } catch (error) {
    // Dev/demo DBs may not include optional tables used for deeper analysis.
    // Avoid log spam and keep the system "green" when these tables don't exist.
    const code = (error as any)?.code
    if (code === '42P01') {
      return
    }
    console.error('[Monitor] Analysis failed:', error)
  }
}

/**
 * Add an alert to the list
 */
function addAlert(alertData: Omit<Alert, 'id' | 'timestamp' | 'resolved'>) {
  // Avoid spamming the same alert every polling tick.
  // If we emitted the same alert recently, skip it.
  const now = Date.now()
  const lastSimilar = [...alerts]
    .reverse()
    .find(
      (a) =>
        !a.resolved &&
        a.severity === alertData.severity &&
        a.title === alertData.title &&
        a.message === alertData.message
    )

  if (lastSimilar && now - lastSimilar.timestamp.getTime() < 60_000) {
    return
  }

  const alert: Alert = {
    id: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
    timestamp: new Date(),
    resolved: false,
    ...alertData,
  }

  alerts.push(alert)

  // Log alert
  console.log(
    `[ALERT] [${alert.severity.toUpperCase()}] ${alert.title}: ${alert.message}`
  )

  // TODO: Send to alerting service (Slack, PagerDuty, etc.)
  if (alert.severity === 'critical') {
    sendCriticalAlert(alert)
  }

  // Keep only last 1000 alerts
  if (alerts.length > 1000) {
    alerts = alerts.slice(-1000)
  }
}

/**
 * Send critical alert to external service
 */
async function sendCriticalAlert(alert: Alert) {
  // TODO: Integrate with your alerting service
  // Examples:
  // - Slack: webhook to #alerts channel
  // - PagerDuty: trigger incident
  // - Email: send to ops@example.com
  // - SMS: send to on-call engineer

  console.log(`[CRITICAL ALERT] Sending to ops team: ${alert.message}`)
}

/**
 * Get all alerts
 */
export function getAlerts(severity?: string, limit: number = 100): Alert[] {
  let result = [...alerts].reverse() // Most recent first

  if (severity) {
    result = result.filter((a) => a.severity === severity)
  }

  return result.slice(0, limit)
}

/**
 * Get recent critical alerts
 */
export function getCriticalAlerts(minutesBack: number = 60): Alert[] {
  const cutoff = Date.now() - minutesBack * 60 * 1000

  return alerts
    .filter(
      (a) =>
        a.severity === 'critical' &&
        a.timestamp.getTime() > cutoff
    )
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
}

/**
 * Resolve an alert
 */
export function resolveAlert(alertId: string): boolean {
  const alert = alerts.find((a) => a.id === alertId)
  if (alert) {
    alert.resolved = true
    return true
  }
  return false
}

/**
 * Clear old alerts
 */
export function clearOldAlerts(daysOld: number = 7): number {
  const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000
  const before = alerts.length

  alerts = alerts.filter((a) => a.timestamp.getTime() > cutoff)

  return before - alerts.length
}

/**
 * Get alert summary
 */
export function getAlertSummary() {
  return {
    total: alerts.length,
    critical: alerts.filter((a) => a.severity === 'critical').length,
    warning: alerts.filter((a) => a.severity === 'warning').length,
    info: alerts.filter((a) => a.severity === 'info').length,
    resolved: alerts.filter((a) => a.resolved).length,
    unresolved: alerts.filter((a) => !a.resolved).length,
    recentCritical: alerts
      .filter((a) => a.severity === 'critical' && !a.resolved)
      .slice(0, 5),
  }
}

/**
 * Export alerts to file
 */
export async function exportAlerts(filename: string = 'alerts-export.json'): Promise<string> {
  const data = {
    exportedAt: new Date().toISOString(),
    summary: getAlertSummary(),
    alerts: alerts.slice(-1000), // Last 1000 alerts
  }

  // TODO: Write to file or cloud storage
  console.log(`[Monitor] Exported ${alerts.length} alerts`)
  return filename
}

// Auto-start monitoring when imported
if (typeof window === 'undefined') {
  // Server-side only
  // Avoid side effects during Next.js build workers.
  if (process.env.NEXT_PHASE !== 'phase-production-build') {
    startMonitoring().catch(console.error)
  }
}
