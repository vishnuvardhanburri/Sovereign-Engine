import { NextRequest, NextResponse } from 'next/server'
import { createDomain, listDomains } from '@/lib/backend'
import { resolveClientId } from '@/lib/client-context'

export async function GET(request: NextRequest) {
  try {
    const clientId = await resolveClientId({
      searchParams: request.nextUrl.searchParams,
      headers: request.headers,
    })

    const domains = await listDomains(clientId)
    return NextResponse.json(domains)
  } catch (error) {
    console.error('[API] Failed to list domains', error)
    return NextResponse.json({ error: 'Failed to list domains' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const clientId = await resolveClientId({
      body,
      headers: request.headers,
    })

    if (!body.domain) {
      return NextResponse.json({ error: 'domain is required' }, { status: 400 })
    }

    const created = await createDomain(clientId, {
      domain: String(body.domain),
      dailyLimit: body.daily_limit ? Number(body.daily_limit) : undefined,
    })

    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    console.error('[API] Failed to create domain', error)
    return NextResponse.json({ error: 'Failed to create domain' }, { status: 500 })
  }
}

