import { NextRequest, NextResponse } from 'next/server'
import { getCampaign, updateCampaignStatus } from '@/lib/backend'
import { resolveClientId } from '@/lib/client-context'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const campaignId = Number(id)
    if (!campaignId) {
      return NextResponse.json({ error: 'Invalid campaign id' }, { status: 400 })
    }

    const clientId = await resolveClientId({
      searchParams: request.nextUrl.searchParams,
      headers: request.headers,
    })

    const campaign = await getCampaign(clientId, campaignId)
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    return NextResponse.json(campaign)
  } catch (error) {
    console.error('[API] Failed to get campaign', error)
    return NextResponse.json({ error: 'Failed to get campaign' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const campaignId = Number(id)
    if (!campaignId) {
      return NextResponse.json({ error: 'Invalid campaign id' }, { status: 400 })
    }

    const body = await request.json()
    const clientId = await resolveClientId({
      body,
      headers: request.headers,
    })

    if (!body.status) {
      return NextResponse.json({ error: 'status is required' }, { status: 400 })
    }

    const campaign = await updateCampaignStatus(
      clientId,
      campaignId,
      body.status,
      Array.isArray(body.contactIds)
        ? body.contactIds.map((value: unknown) => Number(value)).filter(Boolean)
        : undefined
    )

    return NextResponse.json(campaign)
  } catch (error) {
    console.error('[API] Failed to update campaign', error)
    return NextResponse.json({ error: 'Failed to update campaign' }, { status: 500 })
  }
}
