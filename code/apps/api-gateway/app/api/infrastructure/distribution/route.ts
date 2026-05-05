// @ts-nocheck
import { NextResponse } from 'next/server'
import { coordinator } from '@/lib/infrastructure'

/**
 * GET /api/infrastructure/distribution
 * Returns inbox distribution and utilization details
 */
export async function GET() {
  try {
    const report = await coordinator.getReport()

    return NextResponse.json(
      {
        success: true,
        timestamp: new Date().toISOString(),
        data: {
          summary: {
            totalInboxes: report.totalInboxes,
            healthyInboxes: report.healthyInboxes,
            fullyUsedInboxes: report.fullyUsedInboxes,
            availableCapacity: report.availableCapacity,
            averageUtilization: Math.round(report.averageUtilization),
            averageUtilizationPercent: `${Math.round(report.averageUtilization)}%`,
          },
          distributions: report.distributions.map((d: any) => ({
            domain: d.domain,
            inbox: d.inbox,
            sentToday: d.sentToday,
            maxCapacity: 50,
            remaining: d.remaining,
            utilization: Math.round(d.utilization),
            utilizationPercent: `${Math.round(d.utilization)}%`,
            status:
              d.remaining === 0
                ? 'full'
                : d.remaining < 10
                  ? 'high'
                  : d.remaining < 25
                    ? 'medium'
                    : 'low',
          })),
          topUtilized: report.distributions
            .sort((a: any, b: any) => b.utilization - a.utilization)
            .slice(0, 5)
            .map((d: any) => ({
              domain: d.domain,
              inbox: d.inbox,
              utilization: `${Math.round(d.utilization)}%`,
            })),
          topAvailable: report.distributions
            .sort((a: any, b: any) => b.remaining - a.remaining)
            .slice(0, 5)
            .map((d: any) => ({
              domain: d.domain,
              inbox: d.inbox,
              remaining: d.remaining,
            })),
        },
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('[API] Distribution error:', error)
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
