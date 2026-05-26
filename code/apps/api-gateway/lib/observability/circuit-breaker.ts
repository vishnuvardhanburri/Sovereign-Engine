import { query, queryOne } from '@/lib/db'
import { appendOperationalEvent } from '@/lib/operational-events'

export type CircuitState = 'closed' | 'open' | 'half_open'

export async function tripCircuitBreaker(input: {
  clientId: number
  scope: string
  reason: string
  ttlSeconds?: number
  metadata?: Record<string, unknown>
}) {
  const openedUntil = new Date(Date.now() + (input.ttlSeconds ?? 60 * 30) * 1000)
  await query(
    `INSERT INTO circuit_breaker_state (
       client_id,
       scope,
       state,
       reason,
       opened_until,
       metadata,
       opened_at,
       updated_at
     )
     VALUES ($1,$2,'open',$3,$4,$5::jsonb,now(),now())
     ON CONFLICT (client_id, scope) DO UPDATE
     SET state = 'open',
         reason = EXCLUDED.reason,
         opened_until = EXCLUDED.opened_until,
         metadata = circuit_breaker_state.metadata || EXCLUDED.metadata,
         opened_at = now(),
         updated_at = now()`,
    [input.clientId, input.scope, input.reason, openedUntil.toISOString(), JSON.stringify(input.metadata ?? {})]
  )
  await appendOperationalEvent({
    clientId: input.clientId,
    eventType: 'circuit_breaker.opened',
    aggregateType: 'circuit_breaker',
    aggregateId: input.scope,
    payload: { reason: input.reason, openedUntil: openedUntil.toISOString(), metadata: input.metadata ?? {} },
  })
}

export async function closeCircuitBreaker(input: { clientId: number; scope: string; reason?: string }) {
  await query(
    `INSERT INTO circuit_breaker_state (client_id, scope, state, reason, metadata, updated_at)
     VALUES ($1,$2,'closed',$3,'{}'::jsonb,now())
     ON CONFLICT (client_id, scope) DO UPDATE
     SET state = 'closed',
         reason = EXCLUDED.reason,
         opened_until = NULL,
         closed_at = now(),
         updated_at = now()`,
    [input.clientId, input.scope, input.reason ?? 'manual_or_recovered']
  )
  await appendOperationalEvent({
    clientId: input.clientId,
    eventType: 'circuit_breaker.closed',
    aggregateType: 'circuit_breaker',
    aggregateId: input.scope,
    payload: { reason: input.reason ?? 'manual_or_recovered' },
  })
}

export async function isCircuitBreakerOpen(input: { clientId: number; scope: string }) {
  const row = await queryOne<{ state: CircuitState; opened_until: string | null }>(
    `SELECT state, opened_until::text
     FROM circuit_breaker_state
     WHERE client_id = $1 AND scope = $2
     LIMIT 1`,
    [input.clientId, input.scope]
  )
  if (!row || row.state === 'closed') return false
  if (row.opened_until && new Date(row.opened_until).getTime() <= Date.now()) {
    await query(
      `UPDATE circuit_breaker_state
       SET state = 'half_open', updated_at = now()
       WHERE client_id = $1 AND scope = $2`,
      [input.clientId, input.scope]
    )
    return false
  }
  return true
}
