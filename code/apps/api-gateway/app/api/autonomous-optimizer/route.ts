import { NextRequest, NextResponse } from 'next/server'
import { 
  startAutonomousOptimization,
  stopAutonomousOptimization,
  addCampaignToAutonomousOptimization,
  getOptimizationStats,
  getAutonomousOptimizer
} from '@/lib/autonomous-optimizer'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, ...params } = body

    switch (action) {
      case 'start':
        await startAutonomousOptimization()
        return NextResponse.json({ success: true, message: 'Autonomous optimization started' })

      case 'stop':
        stopAutonomousOptimization()
        return NextResponse.json({ success: true, message: 'Autonomous optimization stopped' })

      case 'add_campaign':
        await addCampaignToAutonomousOptimization(params.campaignId, params.config)
        return NextResponse.json({ success: true, message: 'Campaign added to autonomous optimization' })

      case 'remove_campaign':
        getAutonomousOptimizer().removeCampaign(params.campaignId)
        return NextResponse.json({ success: true, message: 'Campaign removed from autonomous optimization' })

      case 'get_stats':
        const stats = await getOptimizationStats()
        return NextResponse.json({ success: true, data: stats })

      default:
        return NextResponse.json(
          { success: false, error: 'Unknown action' },
          { status: 400 }
        )
    }
  } catch (error) {
    console.error('Autonomous optimizer API error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const stats = await getOptimizationStats()
    return NextResponse.json({ success: true, data: stats })
  } catch (error) {
    console.error('Autonomous optimizer GET error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
