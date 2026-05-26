import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { getConnectorDefinition, isIngestionSourceType } from '@/lib/ingestion/connector-registry'
import { enqueueAutonomousJob } from '@/lib/queue/autonomous-queue-client'

function clientIdFrom(request: NextRequest) {
  return Number(request.nextUrl.searchParams.get('client_id') ?? '1') || 1
}

export async function GET(request: NextRequest) {
  const clientId = clientIdFrom(request)
  const rows = await query(
    `SELECT id::text,
            source_type,
            name,
            status,
            auth_type,
            config,
            cursor_state,
            rate_limit_per_minute,
            last_success_at,
            last_error,
            updated_at
     FROM source_connections
     WHERE client_id = $1
     ORDER BY updated_at DESC`,
    [clientId]
  )
  return NextResponse.json({ ok: true, sources: rows.rows })
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const clientId = Number(body.clientId ?? request.nextUrl.searchParams.get('client_id') ?? 1)
  const sourceType = String(body.sourceType ?? '')
  if (!isIngestionSourceType(sourceType)) {
    return NextResponse.json({ ok: false, error: 'unsupported_source_type' }, { status: 400 })
  }
  const definition = getConnectorDefinition(sourceType)
  const name = String(body.name ?? definition.displayName)
  const config = typeof body.config === 'object' && body.config ? body.config : {}
  const authType = String(body.authType ?? definition.authModes[0] ?? 'none')
  const rateLimit = Number(body.rateLimitPerMinute ?? definition.defaultRateLimitPerMinute)

  const source = await queryOne<{ id: string }>(
    `INSERT INTO source_connections (
       client_id,
       source_type,
       name,
       status,
       auth_type,
       config,
       rate_limit_per_minute,
       source_trust
     )
     VALUES ($1,$2,$3,'active',$4,$5::jsonb,$6,$7)
     ON CONFLICT (client_id, source_type, name) DO UPDATE
     SET status = 'active',
         auth_type = EXCLUDED.auth_type,
         config = EXCLUDED.config,
         rate_limit_per_minute = EXCLUDED.rate_limit_per_minute,
         source_trust = EXCLUDED.source_trust,
         updated_at = now()
     RETURNING id::text`,
    [clientId, sourceType, name, authType, JSON.stringify(config), rateLimit, definition.trustScore]
  )

  if (body.runNow && source?.id) {
    await enqueueAutonomousJob({
      clientId,
      kind: 'ingestion.pull',
      sourceConnectionId: source.id,
      limit: Number(body.limit ?? 100),
      requestedBy: 'api',
    })
  }

  return NextResponse.json({ ok: true, sourceId: source?.id, runQueued: Boolean(body.runNow) })
}
