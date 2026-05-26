import { NextRequest, NextResponse } from 'next/server'
import { resolveClientId } from '@/lib/client-context'
import { createIngestionBatch } from '@/lib/ingestion/ingestion-service'
import { appendOperationalEvent } from '@/lib/operational-events'
import { recordUsage } from '@/lib/licensing/enforcement'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const clientId = await resolveClientId({ body, headers: request.headers })
    const records = Array.isArray(body.records) ? body.records : []
    if (!records.length) {
      return NextResponse.json({ error: 'records[] is required' }, { status: 400 })
    }

    const sourceType = String(body.source_type ?? body.sourceType ?? 'rest')
    const result = await createIngestionBatch({
      clientId,
      sourceType,
      records,
      idempotencyKey: typeof body.idempotency_key === 'string' ? body.idempotency_key : undefined,
      sourceConnectionId: typeof body.source_connection_id === 'string' ? body.source_connection_id : undefined,
      requestedBy: request.headers.get('x-actor-id') ?? 'api',
      metadata: {
        requestId: request.headers.get('x-request-id') ?? null,
        userAgent: request.headers.get('user-agent') ?? null,
      },
    })

    await recordUsage({
      clientId,
      meterType: 'api_call',
      source: 'ingestion_batch_api',
      metadata: { sourceType, totalRecords: records.length },
    })

    return NextResponse.json({ ok: true, ...result }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      const body = await request.clone().json().catch(() => ({}))
      const clientId = await resolveClientId({ body, headers: request.headers })
      await appendOperationalEvent({
        clientId,
        eventType: 'ingestion.api_failed',
        aggregateType: 'api_route',
        aggregateId: '/api/ingestion/batch',
        payload: { error: message },
      })
    } catch {
      // Keep the API failure path safe even if telemetry cannot be recorded.
    }
    const status = message.startsWith('license_feature_not_enabled') ? 403 : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
