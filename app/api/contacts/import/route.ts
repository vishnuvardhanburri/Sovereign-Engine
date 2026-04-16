import { NextRequest, NextResponse } from 'next/server'
import { importContacts, parseContactsCsv } from '@/lib/backend'
import { resolveClientId } from '@/lib/client-context'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const clientId = await resolveClientId({
      body,
      headers: request.headers,
    })

    const contacts = Array.isArray(body.contacts)
      ? body.contacts
      : typeof body.csv === 'string'
      ? parseContactsCsv(body.csv)
      : null

    if (!contacts) {
      return NextResponse.json(
        { error: 'Provide either contacts[] or csv' },
        { status: 400 }
      )
    }

    const imported = await importContacts(clientId, {
      contacts,
      verify: body.verify !== false,
      enrich: Boolean(body.enrich),
      dedupeByDomain: Boolean(body.dedupeByDomain),
    })

    return NextResponse.json({
      imported: imported.length,
      contacts: imported,
    })
  } catch (error) {
    console.error('[API] Failed to import contacts', error)
    return NextResponse.json({ error: 'Failed to import contacts' }, { status: 500 })
  }
}
