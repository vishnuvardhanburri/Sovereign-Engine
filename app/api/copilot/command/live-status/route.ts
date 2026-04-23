import { NextRequest, NextResponse } from 'next/server'
import { getCampaignLiveStatus } from '@/lib/ai/live-status'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const campaignIdRaw = searchParams.get('campaignId') ?? searchParams.get('campaign_id')
    const campaignId = campaignIdRaw ? Number.parseInt(campaignIdRaw, 10) : NaN
    if (!Number.isFinite(campaignId) || campaignId <= 0) {
      return NextResponse.json({ ok: false, error: 'campaignId is required' }, { status: 400 })
    }

    const status = await getCampaignLiveStatus({ campaignId })
    if (!status) return NextResponse.json({ ok: false, error: 'Campaign not found' }, { status: 404 })
    return NextResponse.json({ ok: true, data: status })
  } catch (error) {
    console.error('[API] copilot/command/live-status failed', error)
    return NextResponse.json({ ok: false, error: 'Failed to fetch live status' }, { status: 500 })
  }
}

