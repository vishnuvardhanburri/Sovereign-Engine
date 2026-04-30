import { NextRequest, NextResponse } from 'next/server'
import { resolveClientId } from '@/lib/client-context'
import { updateDomainStatus } from '@/lib/backend'
import { recordAuditLog } from '@/lib/security/audit-log'

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

    const domain = await updateDomainStatus(clientId, domainId, 'paused')
    if (!domain) {
      return NextResponse.json({ error: 'Domain not found' }, { status: 404 })
    }

    await recordAuditLog({
      request,
      clientId,
      actionType: 'domain.pause',
      resourceType: 'domain',
      resourceId: domainId,
      details: { status: 'paused' },
    })

    return NextResponse.json(domain)
  } catch (error) {
    console.error('[API] Failed to pause domain', error)
    return NextResponse.json({ error: 'Failed to pause domain' }, { status: 500 })
  }
}
