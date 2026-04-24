import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { resolveClientId } from '@/lib/client-context'

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const clientId = await resolveClientId({ headers: request.headers })
    const { id } = await ctx.params
    const domainId = Number(id)
    if (!Number.isFinite(domainId) || domainId <= 0) {
      return NextResponse.json({ ok: false, error: 'invalid domain id' }, { status: 400 })
    }

    const res = await query<{ id: string; reason: string; metrics_snapshot: any; created_at: string }>(
      `SELECT id::text, reason, metrics_snapshot, created_at
       FROM domain_pause_events
       WHERE client_id = $1 AND domain_id = $2
       ORDER BY created_at DESC
       LIMIT 100`,
      [clientId, domainId]
    )

    return NextResponse.json({ ok: true, domainId, events: res.rows })
  } catch (err) {
    console.error('[api/domains/pause-events] failed', err)
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 })
  }
}

