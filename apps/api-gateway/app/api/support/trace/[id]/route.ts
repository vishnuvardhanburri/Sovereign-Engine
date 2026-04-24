import { NextRequest, NextResponse } from 'next/server'
import { resolveClientId } from '@/lib/client-context'
import { query, queryOne } from '@/lib/db'

export async function POST(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const traceId = String(id || '').trim()
    if (!traceId) return NextResponse.json({ ok: false, error: 'missing_trace_id' }, { status: 400 })

    const clientId = await resolveClientId({ headers: _request.headers })

    const audit = await queryOne<any>(
      `SELECT *
       FROM decision_audit_logs
       WHERE client_id = $1 AND trace_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [clientId, traceId]
    )

    const queueJobId = audit?.queue_job_id ?? null
    const job = queueJobId
      ? await queryOne<any>(
          `SELECT id, campaign_id, contact_id, sequence_step, scheduled_at, recipient_email, idempotency_key, metadata, status, provider_message_id, created_at, updated_at
           FROM queue_jobs
           WHERE client_id = $1 AND id = $2`,
          [clientId, queueJobId]
        )
      : null

    const events = queueJobId
      ? await query<any>(
          `SELECT id, event_type, provider_message_id, metadata, created_at
           FROM events
           WHERE client_id = $1 AND queue_job_id = $2
           ORDER BY created_at ASC`,
          [clientId, queueJobId]
        )
      : { rows: [] }

    const advancedTrace = job?.metadata?.advanced_trace ?? null

    return NextResponse.json({
      ok: true,
      traceId,
      audit,
      queueJob: job,
      advancedTrace,
      events: events.rows,
    })
  } catch (error) {
    console.error('[api/support/trace] failed', error)
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'support/trace' })
}

