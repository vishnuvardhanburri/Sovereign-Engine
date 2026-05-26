import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { resolveClientId } from '@/lib/client-context'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const clientId = await resolveClientId({
      searchParams: request.nextUrl.searchParams,
      headers: request.headers,
    })

    const job = await queryOne(
      `SELECT id::text,
              source_type,
              status,
              total_records,
              accepted_records,
              rejected_records,
              enriched_records,
              failure_count,
              metadata,
              created_at::text,
              completed_at::text
       FROM ingestion_jobs
       WHERE client_id = $1 AND id = $2
       LIMIT 1`,
      [clientId, id]
    )

    if (!job) {
      return NextResponse.json({ error: 'ingestion job not found' }, { status: 404 })
    }

    const [events, failures] = await Promise.all([
      query(
        `SELECT id::text, event_type, payload, created_at::text
         FROM ingestion_events
         WHERE client_id = $1 AND ingestion_job_id = $2
         ORDER BY created_at DESC
         LIMIT 100`,
        [clientId, id]
      ),
      query(
        `SELECT id::text, stage, error_code, error_message, retry_count, created_at::text
         FROM ingestion_failures
         WHERE client_id = $1 AND ingestion_job_id = $2
         ORDER BY created_at DESC
         LIMIT 100`,
        [clientId, id]
      ),
    ])

    return NextResponse.json(
      { ok: true, job, events: events.rows, failures: failures.rows },
      { headers: { 'cache-control': 'no-store' } }
    )
  } catch (error) {
    console.error('[API] ingestion job lookup failed', error)
    return NextResponse.json({ error: 'failed to load ingestion job' }, { status: 500 })
  }
}
