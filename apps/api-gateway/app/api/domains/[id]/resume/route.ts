import { NextRequest, NextResponse } from 'next/server'
import { resolveClientId } from '@/lib/client-context'
import { updateDomainStatus } from '@/lib/backend'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const domainId = Number(id)
    if (!domainId) {
      return NextResponse.json({ error: 'Invalid domain id' }, { status: 400 })
    }

    const clientId = await resolveClientId({
      searchParams: request.nextUrl.searchParams,
      headers: request.headers,
    })

    const domain = await updateDomainStatus(clientId, domainId, 'active')
    if (!domain) {
      return NextResponse.json({ error: 'Domain not found' }, { status: 404 })
    }

    return NextResponse.json(domain)
  } catch (error) {
    console.error('[API] Failed to resume domain', error)
    return NextResponse.json({ error: 'Failed to resume domain' }, { status: 500 })
  }
}
