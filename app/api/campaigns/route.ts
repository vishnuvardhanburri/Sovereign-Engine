import { NextRequest, NextResponse } from 'next/server'
import { createCampaign, listCampaigns } from '@/lib/backend'
import { resolveClientId } from '@/lib/client-context'

export async function GET(request: NextRequest) {
  try {
    const clientId = await resolveClientId({
      searchParams: request.nextUrl.searchParams,
      headers: request.headers,
    })

    const campaigns = await listCampaigns(clientId)
    return NextResponse.json(campaigns)
  } catch (error) {
    console.error('[API] Failed to list campaigns', error)
    return NextResponse.json({ error: 'Failed to list campaigns' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const clientId = await resolveClientId({
      body,
      headers: request.headers,
    })

    if (!body.name || !body.sequenceId) {
      return NextResponse.json(
        { error: 'name and sequenceId are required' },
        { status: 400 }
      )
    }

    const campaign = await createCampaign(clientId, {
      name: String(body.name),
      sequenceId: Number(body.sequenceId),
      contactIds: Array.isArray(body.contactIds)
        ? body.contactIds.map((value: unknown) => Number(value)).filter(Boolean)
        : undefined,
      angle: body.angle,
      fromIdentityMode: body.fromIdentityMode,
      timezoneStrategy: body.timezoneStrategy,
      abTestEnabled: Boolean(body.abTestEnabled),
      dailyTarget: body.dailyTarget ? Number(body.dailyTarget) : undefined,
    })

    return NextResponse.json(campaign, { status: 201 })
  } catch (error) {
    console.error('[API] Failed to create campaign', error)
    return NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 })
  }
}
