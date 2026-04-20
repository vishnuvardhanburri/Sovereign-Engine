import { NextRequest, NextResponse } from 'next/server'
import { createEvent, listEvents } from '@/lib/backend'
import { resolveClientId } from '@/lib/client-context'

type EventTypeFilter = 'queued' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'failed' | 'bounce' | 'reply' | 'complaint' | 'skipped' | 'retry' | 'unsubscribed'
type CreateEventBody = {
  type?: EventTypeFilter
  campaign_id?: string | number | null
  contact_id?: string | number | null
  identity_id?: string | number | null
  domain_id?: string | number | null
  queue_job_id?: string | number | null
  provider_message_id?: string | null
  metadata?: Record<string, unknown> | null
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const clientId = await resolveClientId({
      searchParams,
      headers: request.headers,
    })

    const events = await listEvents(clientId, {
      page: Number(searchParams.get('page') ?? 1),
      limit: Number(searchParams.get('limit') ?? 50),
      eventType: (searchParams.get('type') as EventTypeFilter | null) ?? undefined,
      campaignId: Number(searchParams.get('campaign_id') ?? 0) || undefined,
      identityId: Number(searchParams.get('identity_id') ?? 0) || undefined,
    })

    return NextResponse.json(events)
  } catch (error) {
    console.error('[API] Failed to list events', error)
    return NextResponse.json({ error: 'Failed to list events' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateEventBody
    const clientId = await resolveClientId({
      body,
      headers: request.headers,
    })

    if (!body.type) {
      return NextResponse.json({ error: 'type is required' }, { status: 400 })
    }

    const event = await createEvent(clientId, {
      eventType: body.type,
      campaignId: body.campaign_id ? Number(body.campaign_id) : null,
      contactId: body.contact_id ? Number(body.contact_id) : null,
      identityId: body.identity_id ? Number(body.identity_id) : null,
      domainId: body.domain_id ? Number(body.domain_id) : null,
      queueJobId: body.queue_job_id ? Number(body.queue_job_id) : null,
      providerMessageId: body.provider_message_id ?? null,
      metadata: body.metadata ?? null,
    })

    return NextResponse.json(event, { status: 201 })
  } catch (error) {
    console.error('[API] Failed to create event', error)
    return NextResponse.json({ error: 'Failed to create event' }, { status: 500 })
  }
}
