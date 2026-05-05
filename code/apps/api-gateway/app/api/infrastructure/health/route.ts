/**
 * Infrastructure Health & Status Endpoint
 * GET /api/infrastructure/health
 */

import { NextRequest, NextResponse } from 'next/server'
import { coordinator } from '@/lib/infrastructure'
import { getAlerts, getCriticalAlerts, getAlertSummary } from '@/lib/infrastructure-monitoring'
import { getMetricsSnapshot, getDomainAnalytics } from '@/lib/infrastructure-analytics'

export async function GET(request: NextRequest) {
  try {
    const [state, metrics, domains, alerts, criticalAlerts] = await Promise.all([
      coordinator.getState(),
      getMetricsSnapshot(),
      getDomainAnalytics(),
      getAlerts('warning', 20),
      getCriticalAlerts(60),
    ])

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      status: state.isPaused ? 'paused' : 'running',
      system: {
        healthy: state.systemHealth.isHealthy,
        issues: state.systemHealth.issues,
        capacityUtilization: Math.round(state.capacityUtilization),
        targetCapacity: state.targetCapacity,
        currentCapacity: state.currentCapacity,
      },
      metrics: {
        domains: metrics.domainCount,
        healthyDomains: metrics.healthyDomains,
        inboxes: metrics.inboxCount,
        capacityUtilization: Math.round(metrics.capacityUtilization),
        emailsSent24h: metrics.emailsSent24h,
        avgDeliveryTime: Math.round(metrics.avgDeliveryTime * 1000) / 1000,
        uptime: Math.round(metrics.uptime * 10) / 10,
      },
      topDomains: domains
        .filter((d) => d.emailsSent24h > 0)
        .slice(0, 5)
        .map((d) => ({
          domain: d.domain,
          health: d.health,
          sent24h: d.emailsSent24h,
          bounceRate: Math.round(d.bounceRate * 10000) / 100,
          spamRate: Math.round(d.spamRate * 10000) / 100,
        })),
      alerts: {
        summary: getAlertSummary(),
        critical: criticalAlerts.slice(0, 5),
        recent: alerts.slice(0, 5),
      },
    })
  } catch (error) {
    console.error('[API] Health check error:', error)
    return NextResponse.json(
      { error: 'Health check failed', details: String(error) },
      { status: 500 }
    )
  }
}
