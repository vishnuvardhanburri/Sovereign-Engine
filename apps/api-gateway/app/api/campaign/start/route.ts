import { NextRequest, NextResponse } from 'next/server'
import { enqueueCampaignJobs, getCampaign } from '@/lib/backend'
import { resolveClientId } from '@/lib/client-context'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const clientId = await resolveClientId({
      body,
      headers: request.headers,
    })

    if (!body.campaign_id) {
      return NextResponse.json(
        { error: 'campaign_id is required' },
        { status: 400 }
      )
    }

    const campaignId = Number(body.campaign_id)
    const campaign = await getCampaign(clientId, campaignId)
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    const result = await enqueueCampaignJobs(
      clientId,
      campaignId,
      Array.isArray(body.contact_ids)
        ? body.contact_ids.map((value: unknown) => Number(value)).filter(Boolean)
        : undefined
    )

    return NextResponse.json({
      campaign_id: campaignId,
      queued_jobs: result.jobs.length,
      contact_count: result.contactCount,
    })
  } catch (error) {
    console.error('[API] Failed to start campaign', error)
    return NextResponse.json({ error: 'Failed to start campaign' }, { status: 500 })
  }
}

