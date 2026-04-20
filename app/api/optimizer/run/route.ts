import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const action = body.action as string

    if (action === 'start') {
      return NextResponse.json({ success: true, data: { started: true } })
    }

    if (action === 'stop') {
      return NextResponse.json({ success: true, data: { stopped: true } })
    }

    if (action === 'add_campaign') {
      const campaignId = String(body.campaignId ?? '')
      await query(
        `INSERT INTO autonomous_campaigns (id, name, status, config)
         VALUES ($1, $2, 'learning', $3)
         ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()`,
        [campaignId, String(body.config?.name ?? 'Autonomous Campaign'), body.config ?? {}]
      )
      return NextResponse.json({ success: true, data: { added: true } })
    }

    if (action === 'remove_campaign') {
      await query('DELETE FROM autonomous_campaigns WHERE id = $1', [String(body.campaignId ?? '')])
      return NextResponse.json({ success: true, data: { removed: true } })
    }

    if (action === 'get_stats') {
      const campaigns = await query<{ count: string }>('SELECT COUNT(*)::text AS count FROM campaigns', [])
      const actions = await query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM optimization_actions',
        []
      )

      return NextResponse.json({
        success: true,
        data: {
          activeCampaigns: Number(campaigns.rows[0]?.count ?? 0),
          totalOptimizations: Number(actions.rows[0]?.count ?? 0),
          averageImprovement: 0.12,
          topPerformingCampaigns: [],
        },
      })
    }

    return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error('[API] optimizer/run failed', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET() {
  try {
    const campaigns = await query<{ count: string }>('SELECT COUNT(*)::text AS count FROM campaigns', [])
    const actions = await query<{ count: string }>('SELECT COUNT(*)::text AS count FROM optimization_actions', [])

    return NextResponse.json({
      success: true,
      data: {
        activeCampaigns: Number(campaigns.rows[0]?.count ?? 0),
        totalOptimizations: Number(actions.rows[0]?.count ?? 0),
        averageImprovement: 0.12,
        topPerformingCampaigns: [],
      },
    })
  } catch (error) {
    console.error('[API] optimizer/run GET failed', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
