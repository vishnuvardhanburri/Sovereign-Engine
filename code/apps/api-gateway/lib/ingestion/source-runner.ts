import { query, queryOne } from '@/lib/db'
import { isIngestionSourceType, type IngestionSourceType } from '@/lib/ingestion/connector-registry'
import { getIngestionConnector } from '@/lib/ingestion/connectors'
import type { SourceConnection } from '@/lib/ingestion/connectors/base'
import { createIngestionBatch } from '@/lib/ingestion/ingestion-service'
import { appendOperationalEvent, stableHash } from '@/lib/operational-events'

interface SourceConnectionRow {
  id: string
  client_id: string
  source_type: string
  name: string
  auth_type: SourceConnection['authType']
  config: Record<string, unknown>
  cursor_state: Record<string, unknown>
  rate_limit_per_minute: number
}

function toSourceConnection(row: SourceConnectionRow): SourceConnection {
  if (!isIngestionSourceType(row.source_type)) {
    throw new Error(`unsupported_ingestion_source:${row.source_type}`)
  }
  return {
    id: row.id,
    clientId: Number(row.client_id),
    sourceType: row.source_type as IngestionSourceType,
    name: row.name,
    authType: row.auth_type,
    config: row.config ?? {},
    cursorState: row.cursor_state ?? {},
    rateLimitPerMinute: Number(row.rate_limit_per_minute),
  }
}

export async function loadSourceConnection(clientId: number, sourceConnectionId: string): Promise<SourceConnection> {
  const row = await queryOne<SourceConnectionRow>(
    `SELECT id::text,
            client_id::text,
            source_type,
            name,
            auth_type,
            config,
            cursor_state,
            rate_limit_per_minute
     FROM source_connections
     WHERE client_id = $1
       AND id = $2
       AND status = 'active'
     LIMIT 1`,
    [clientId, sourceConnectionId]
  )
  if (!row) throw new Error('source_connection_not_found_or_inactive')
  return toSourceConnection(row)
}

export async function runSourceConnection(input: {
  clientId: number
  sourceConnectionId: string
  limit?: number
  requestedBy?: string
}) {
  const connection = await loadSourceConnection(input.clientId, input.sourceConnectionId)
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 1000)
  const connector = getIngestionConnector(connection.sourceType)
  const pull = await connector.pull({ connection, limit })
  const idempotencyKey = stableHash({
    sourceConnectionId: connection.id,
    sourceType: connection.sourceType,
    cursor: connection.cursorState,
    records: pull.records.map((record) => stableHash(record)),
  })

  const result =
    pull.records.length > 0
      ? await createIngestionBatch({
          clientId: input.clientId,
          sourceType: connection.sourceType,
          sourceConnectionId: connection.id,
          records: pull.records,
          idempotencyKey,
          requestedBy: input.requestedBy ?? 'autonomous_ops_worker',
          metadata: { sourceConnectionName: connection.name, exhausted: pull.exhausted ?? false },
        })
      : {
          jobId: '',
          status: 'completed' as const,
          totalRecords: 0,
          acceptedRecords: 0,
          rejectedRecords: 0,
          enrichedRecords: 0,
          failures: [],
          alreadyProcessed: false,
        }

  await query(
    `UPDATE source_connections
     SET cursor_state = $3::jsonb,
         last_success_at = now(),
         last_error = NULL,
         updated_at = now()
     WHERE client_id = $1 AND id = $2`,
    [input.clientId, connection.id, JSON.stringify(pull.nextCursor ?? connection.cursorState)]
  )

  await appendOperationalEvent({
    clientId: input.clientId,
    eventType: 'ingestion.source_pulled',
    aggregateType: 'source_connection',
    aggregateId: connection.id,
    actorType: 'worker',
    payload: {
      sourceType: connection.sourceType,
      pulled: pull.records.length,
      accepted: result.acceptedRecords,
      rejected: result.rejectedRecords,
      exhausted: pull.exhausted ?? false,
    },
  })

  return { connection, pull, result }
}

export async function markSourceConnectionFailure(input: {
  clientId: number
  sourceConnectionId: string
  error: string
}) {
  await query(
    `UPDATE source_connections
     SET status = 'degraded',
         last_error = $3,
         updated_at = now()
     WHERE client_id = $1 AND id = $2`,
    [input.clientId, input.sourceConnectionId, input.error.slice(0, 500)]
  )
  await appendOperationalEvent({
    clientId: input.clientId,
    eventType: 'ingestion.source_failed',
    aggregateType: 'source_connection',
    aggregateId: input.sourceConnectionId,
    actorType: 'worker',
    payload: { error: input.error.slice(0, 500) },
  })
}
