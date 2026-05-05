import { NextRequest, NextResponse } from 'next/server'
import { deleteDomain } from '@/lib/backend'
import { resolveClientId } from '@/lib/client-context'
import { recordAuditLog } from '@/lib/security/audit-log'

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const domainId = Number(id)
    if (!Number.isFinite(domainId)) {
      return NextResponse.json({ error: 'Invalid domain id' }, { status: 400 })
    }

    const url = new URL(request.url)
    const confirm = url.searchParams.get('confirm') === 'true'
    if (!confirm) {
      return NextResponse.json(
        { error: 'Confirmation required. Pass ?confirm=true' },
        { status: 400 }
      )
    }

    const clientId = await resolveClientId({ headers: request.headers })
    const deleted = await deleteDomain(clientId, domainId)
    if (!deleted) {
      return NextResponse.json({ error: 'Domain not found' }, { status: 404 })
    }

    await recordAuditLog({
      request,
      clientId,
      actionType: 'domain.delete',
      resourceType: 'domain',
      resourceId: domainId,
      details: { confirm },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[API] Failed to delete domain', error)
    return NextResponse.json({ error: 'Failed to delete domain' }, { status: 500 })
  }
}
