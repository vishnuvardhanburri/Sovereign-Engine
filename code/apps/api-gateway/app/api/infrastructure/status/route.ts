// @ts-nocheck
import { NextResponse } from 'next/server'
import { coordinator } from '@/lib/infrastructure'

/**
 * GET /api/infrastructure/status
 * Returns current infrastructure state and health
 */
export async function GET() {
  try {
    const state = await coordinator.getState()

    return NextResponse.json(
      {
        success: true,
        timestamp: new Date().toISOString(),
        data: {
          capacity: {
            current: state.currentCapacity,
            target: state.targetCapacity,
            utilization: state.capacityUtilization,
            utilizationPercent: `${Math.round(state.capacityUtilization)}%`,
            gap: state.targetCapacity - state.currentCapacity,
          },
          domains: {
            healthy: state.healthyDomains,
            totalInboxes: state.totalInboxes,
            inboxesPerDomain: 4,
            capacityPerDomain: 200,
          },
          health: {
            status: state.systemHealth.isHealthy ? 'healthy' : 'degraded',
            isHealthy: state.systemHealth.isHealthy,
            issueCount: state.systemHealth.issues.length,
            issues: state.systemHealth.issues,
            lastCheck: state.lastHealthCheck.toISOString(),
          },
          system: {
            isPaused: state.isPaused,
            lastOptimization: state.lastOptimization.toISOString(),
            autoHealingEnabled: true,
            backgroundMonitoring: true,
          },
        },
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('[API] Infrastructure status error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}
