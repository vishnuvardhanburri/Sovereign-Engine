import { NextRequest, NextResponse } from 'next/server'
import { createDomain, listDomains } from '@/lib/backend'
import { resolveClientId } from '@/lib/client-context'
import { recordAuditLog } from '@/lib/security/audit-log'

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

    await recordAuditLog({
      request,
      clientId,
      actionType: 'domain.create',
      resourceType: 'domain',
      resourceId: (created as any).id ?? String(body.domain),
      details: {
        domain: String(body.domain).toLowerCase(),
        daily_limit: body.daily_limit ? Number(body.daily_limit) : null,
      },
    })

    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    console.error('[API] Failed to create domain', error)
    const msg = (error as any)?.message ?? ''
    if (String(msg).toLowerCase().includes('invalid domain')) {
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to create domain' }, { status: 500 })
  }
}
