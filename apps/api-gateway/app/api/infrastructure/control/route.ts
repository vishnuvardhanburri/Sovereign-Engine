import { NextResponse } from 'next/server'
import { coordinator } from '@/lib/infrastructure'

/**
 * POST /api/infrastructure/control
 * Pause or resume sending
 *
 * Request body:
 * {
 *   action: 'pause' | 'resume',
 *   reason?: string
 * }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { action, reason } = body

    if (!action || !['pause', 'resume', 'optimize', 'heal', 'scale'].includes(action)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid action. Must be "pause", "resume", "optimize", "heal", or "scale"',
        },
        { status: 400 }
      )
    }

    if (action === 'pause') {
      await coordinator.pause(reason || 'Manual pause via API')
      return NextResponse.json(
        {
          success: true,
          status: 'paused',
          reason: reason || 'Manual pause via API',
          timestamp: new Date().toISOString(),
        },
        { status: 200 }
      )
    }

    if (action === 'resume') {
      await coordinator.resume()
      return NextResponse.json(
        {
          success: true,
          status: 'resumed',
          timestamp: new Date().toISOString(),
        },
        { status: 200 }
      )
    }

    if (action === 'optimize') {
      const startTime = Date.now()
      const result = await coordinator.optimize()
      const duration = Date.now() - startTime

      return NextResponse.json(
        {
          success: true,
          action: 'optimize',
          duration: duration,
          changes: result,
          timestamp: new Date().toISOString(),
        },
        { status: 200 }
      )
    }

    if (action === 'heal') {
      const startTime = Date.now()
      const result = await coordinator.heal()
      const duration = Date.now() - startTime

      return NextResponse.json(
        {
          success: true,
          action: 'heal',
          duration: duration,
          actions: result,
          timestamp: new Date().toISOString(),
        },
        { status: 200 }
      )
    }

    if (action === 'scale') {
      const { targetCapacity, maxDomains } = body
      const startTime = Date.now()
      const result = await coordinator.scale(targetCapacity, maxDomains || 5)
      const duration = Date.now() - startTime

      return NextResponse.json(
        {
          success: true,
          action: 'scale',
          duration: duration,
          changes: result,
          timestamp: new Date().toISOString(),
        },
        { status: 200 }
      )
    }

    return NextResponse.json(
      { success: false, error: 'Invalid action' },
      { status: 400 }
    )
  } catch (error) {
    console.error('[API] Control error:', error)
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

/**
 * GET /api/infrastructure/control
 * Get current state and status
 */
export async function GET() {
  try {
    const state = await coordinator.getState()

    return NextResponse.json(
      {
        success: true,
        data: {
          isPaused: state.isPaused,
          status: state.isPaused ? 'paused' : 'running',
          currentCapacity: state.currentCapacity,
          targetCapacity: state.targetCapacity,
          capacityUtilization: Math.round(state.capacityUtilization),
          healthyDomains: state.healthyDomains,
          totalDomains: state.totalDomains,
          systemHealth: {
            isHealthy: state.systemHealth.isHealthy,
            issues: state.systemHealth.issues,
            issueCount: state.systemHealth.issues.length,
          },
          lastOptimization: state.lastOptimization?.toISOString(),
          lastHealing: state.lastHealing?.toISOString(),
          timestamp: new Date().toISOString(),
        },
      },
      { status: 200 }
    )
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
