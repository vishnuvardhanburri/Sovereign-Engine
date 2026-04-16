import { NextRequest, NextResponse } from 'next/server'
import { createIdentity, listIdentities } from '@/lib/backend'
import { resolveClientId } from '@/lib/client-context'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const domainId = Number(searchParams.get('domain_id') ?? 0)
    if (!domainId) {
      return NextResponse.json({ error: 'domain_id is required' }, { status: 400 })
    }

    const clientId = await resolveClientId({
      searchParams,
      headers: request.headers,
    })

    const result = await listIdentities(clientId, domainId, {
      page: Number(searchParams.get('page') ?? 1),
      limit: Number(searchParams.get('limit') ?? 50),
    })

    return NextResponse.json(result.data)
  } catch (error) {
    console.error('[API] Failed to list identities', error)
    return NextResponse.json({ error: 'Failed to list identities' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const clientId = await resolveClientId({
      body,
      headers: request.headers,
    })

    if (!body.domain_id || !body.email) {
      return NextResponse.json(
        { error: 'domain_id and email are required' },
        { status: 400 }
      )
    }

    const identity = await createIdentity(clientId, {
      domainId: Number(body.domain_id),
      email: String(body.email),
      dailyLimit: body.daily_limit ? Number(body.daily_limit) : undefined,
    })

    return NextResponse.json(identity, { status: 201 })
  } catch (error) {
    console.error('[API] Failed to create identity', error)
    return NextResponse.json({ error: 'Failed to create identity' }, { status: 500 })
  }
}

