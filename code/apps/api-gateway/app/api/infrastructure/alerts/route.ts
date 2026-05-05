/**
 * Infrastructure Alerts Management Endpoint
 * GET /api/infrastructure/alerts
 * POST /api/infrastructure/alerts/:id/resolve
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  getAlerts,
  getCriticalAlerts,
  getAlertSummary,
  resolveAlert,
  clearOldAlerts,
} from '@/lib/infrastructure-monitoring'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const severity = searchParams.get('severity') || undefined
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 500)
    const hoursBack = parseInt(searchParams.get('hoursBack') ?? '24', 10)

    let alerts

    if (severity === 'critical') {
      alerts = getCriticalAlerts(hoursBack * 60)
    } else {
      alerts = getAlerts(severity, limit)
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      summary: getAlertSummary(),
      alerts: alerts.map((a) => ({
        id: a.id,
        severity: a.severity,
        title: a.title,
        message: a.message,
        component: a.component,
        timestamp: a.timestamp.toISOString(),
        resolved: a.resolved,
        metadata: a.metadata,
      })),
      count: alerts.length,
    })
  } catch (error) {
    console.error('[API] Alerts fetch error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch alerts', details: String(error) },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const pathname = request.nextUrl.pathname
    const parts = pathname.split('/')

    // POST /api/infrastructure/alerts/:id/resolve
    if (parts.includes('resolve')) {
      const alertId = parts[parts.length - 2]

      if (!alertId) {
        return NextResponse.json(
          { error: 'Alert ID required' },
          { status: 400 }
        )
      }

      const success = resolveAlert(alertId)

      if (!success) {
        return NextResponse.json(
          { error: 'Alert not found', alertId },
          { status: 404 }
        )
      }

      return NextResponse.json({
        success: true,
        alertId,
        message: 'Alert resolved',
      })
    }

    // POST /api/infrastructure/alerts/cleanup
    if (pathname.endsWith('/cleanup')) {
      const daysOld = parseInt(request.headers.get('x-days-old') ?? '7', 10)
      const count = clearOldAlerts(daysOld)

      return NextResponse.json({
        success: true,
        message: `Cleaned up ${count} old alerts`,
        cleared: count,
      })
    }

    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400 }
    )
  } catch (error) {
    console.error('[API] Alerts POST error:', error)
    return NextResponse.json(
      { error: 'Alert operation failed', details: String(error) },
      { status: 500 }
    )
  }
}
