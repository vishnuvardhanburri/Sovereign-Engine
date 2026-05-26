import crypto from 'node:crypto'
import { query, queryOne } from '@/lib/db'

export type OperationalActorType = 'system' | 'user' | 'api_key' | 'worker'

export interface AppendOperationalEventInput {
  clientId: number
  eventType: string
  aggregateType: string
  aggregateId: string | number
  eventVersion?: number
  actorType?: OperationalActorType
  actorId?: string | number | null
  idempotencyKey?: string | null
  payload?: Record<string, unknown>
  metadata?: Record<string, unknown>
  occurredAt?: Date
}

export interface OperationalEventRow {
  id: string
  client_id: string
  event_type: string
  aggregate_type: string
  aggregate_id: string
  payload: Record<string, unknown>
  metadata: Record<string, unknown>
  created_at: string
}

export function stableHash(value: unknown): string {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex')
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`)
    .join(',')}}`
}

export function eventIdempotencyKey(input: {
  clientId: number
  eventType: string
  aggregateType: string
  aggregateId: string | number
  payload?: Record<string, unknown>
}): string {
  return stableHash({
    clientId: input.clientId,
    eventType: input.eventType,
    aggregateType: input.aggregateType,
    aggregateId: String(input.aggregateId),
    payload: input.payload ?? {},
  })
}

export async function appendOperationalEvent(
  input: AppendOperationalEventInput
): Promise<OperationalEventRow> {
  const idempotencyKey =
    input.idempotencyKey ??
    eventIdempotencyKey({
      clientId: input.clientId,
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      payload: input.payload,
    })

  const inserted = await queryOne<OperationalEventRow>(
    `INSERT INTO operational_events (
       client_id,
       event_type,
       event_version,
       aggregate_type,
       aggregate_id,
       actor_type,
       actor_id,
       idempotency_key,
       payload,
       metadata,
       occurred_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,COALESCE($11::timestamptz, now()))
     ON CONFLICT DO NOTHING
     RETURNING id, client_id::text, event_type, aggregate_type, aggregate_id, payload, metadata, created_at::text`,
    [
      input.clientId,
      input.eventType,
      input.eventVersion ?? 1,
      input.aggregateType,
      String(input.aggregateId),
      input.actorType ?? 'system',
      input.actorId ? String(input.actorId) : null,
      idempotencyKey,
      JSON.stringify(input.payload ?? {}),
      JSON.stringify(input.metadata ?? {}),
      input.occurredAt?.toISOString() ?? null,
    ]
  )

  if (inserted) return inserted

  const existing = await queryOne<OperationalEventRow>(
    `SELECT id, client_id::text, event_type, aggregate_type, aggregate_id, payload, metadata, created_at::text
     FROM operational_events
     WHERE client_id = $1 AND idempotency_key = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [input.clientId, idempotencyKey]
  )

  if (!existing) {
    throw new Error('operational_event_append_failed')
  }

  return existing
}

export async function listOperationalEvents(input: {
  clientId: number
  limit?: number
  eventType?: string
}): Promise<OperationalEventRow[]> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 500)
  const result = await query<OperationalEventRow>(
    `SELECT id, client_id::text, event_type, aggregate_type, aggregate_id, payload, metadata, created_at::text
     FROM operational_events
     WHERE client_id = $1 AND ($2::text IS NULL OR event_type = $2)
     ORDER BY created_at DESC
     LIMIT $3`,
    [input.clientId, input.eventType ?? null, limit]
  )
  return result.rows
}

export async function recordTelemetrySnapshot(input: {
  clientId: number
  snapshotType: string
  metrics: Record<string, unknown>
}): Promise<void> {
  await query(
    `INSERT INTO telemetry_snapshots (client_id, snapshot_type, metrics)
     VALUES ($1, $2, $3::jsonb)`,
    [input.clientId, input.snapshotType, JSON.stringify(input.metrics)]
  )
}
