import { NextRequest, NextResponse } from 'next/server'
import { importContacts, listContacts } from '@/lib/backend'
import { resolveClientId } from '@/lib/client-context'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const clientId = await resolveClientId({
      searchParams,
      headers: request.headers,
    })
    const page = Number(searchParams.get('page') ?? 1)
    const limit = Number(searchParams.get('limit') ?? 50)
    const campaignId = Number(searchParams.get('campaign_id') ?? 0) || undefined

    const result = await listContacts(clientId, { page, limit, campaignId })
    return NextResponse.json(result)
  } catch (error) {
    console.error('[API] Failed to list contacts', error)
    return NextResponse.json({ error: 'Failed to list contacts' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const clientId = await resolveClientId({
      body,
      headers: request.headers,
    })

    const contacts = Array.isArray(body.contacts) ? body.contacts : body
    if (!Array.isArray(contacts)) {
      return NextResponse.json(
        { error: 'contacts array is required' },
        { status: 400 }
      )
    }

    const created = await importContacts(clientId, {
      contacts,
      verify: Boolean(body.verify),
      enrich: Boolean(body.enrich),
      dedupeByDomain: Boolean(body.dedupeByDomain),
    })
    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    console.error('[API] Failed to create contacts', error)
    return NextResponse.json({ error: 'Failed to create contacts' }, { status: 500 })
  }
}
