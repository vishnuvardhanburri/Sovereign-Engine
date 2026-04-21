import { query } from '@/lib/db'
import { emitEvent } from '@/lib/events'

export type InboxPlacement = 'inbox' | 'spam' | 'unknown'

export interface SeedPlacementSignal {
  client_id: number
  domain_id: number
  identity_id?: number | null
  seed_email: string
  placement: InboxPlacement
  observed_at: string
  provider?: string | null
  metadata?: Record<string, unknown>
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export async function recordSeedPlacement(signal: SeedPlacementSignal): Promise<void> {
  // Store as metric row for auditing + long-term learning.
  await query(
    `INSERT INTO system_metrics (client_id, metric_name, metric_value, metadata)
     VALUES ($1, $2, $3, $4)`,
    [
      signal.client_id,
      'seed_placement',
      signal.placement === 'inbox' ? 1 : signal.placement === 'spam' ? 0 : 0.5,
      {
        domain_id: signal.domain_id,
        identity_id: signal.identity_id ?? null,
        seed_email: signal.seed_email,
        placement: signal.placement,
        observed_at: signal.observed_at,
        provider: signal.provider ?? null,
        ...(signal.metadata ?? {}),
      },
    ]
  )

  // Reputation update: deterministic nudge based on placement.
  const delta = signal.placement === 'inbox' ? 1.5 : signal.placement === 'spam' ? -4 : -0.5
  await query(
    `UPDATE domains
     SET health_score = GREATEST(0, LEAST(100, health_score + $3)),
         updated_at = CURRENT_TIMESTAMP
     WHERE client_id = $1 AND id = $2`,
    [signal.client_id, signal.domain_id, delta]
  )

  await emitEvent({
    event_type: 'INBOX_PLACEMENT_SIGNAL',
    source_agent: 'inbox_signal',
    payload: {
      client_id: signal.client_id,
      domain_id: signal.domain_id,
      identity_id: signal.identity_id ?? null,
      placement: signal.placement,
      seed_email: signal.seed_email,
      observed_at: signal.observed_at,
    },
  })
}

export async function summarizeSeedPlacement(clientId: number, domainId: number, windowHours = 24): Promise<{
  inbox_rate: number
  spam_rate: number
  samples: number
}> {
  const hours = clamp(windowHours, 1, 168)
  const result = await query<{ samples: string; inbox: string; spam: string }>(
    `
    SELECT
      COUNT(*)::text AS samples,
      COUNT(*) FILTER (WHERE (metadata->>'placement') = 'inbox')::text AS inbox,
      COUNT(*) FILTER (WHERE (metadata->>'placement') = 'spam')::text AS spam
    FROM system_metrics
    WHERE client_id = $1
      AND metric_name = 'seed_placement'
      AND (metadata->>'domain_id')::bigint = $2
      AND created_at > NOW() - ($3::text)::interval
    `,
    [clientId, domainId, `${hours} hours`]
  )
  const row = result.rows[0]
  const samples = Number(row?.samples ?? 0) || 0
  const inbox = Number(row?.inbox ?? 0) || 0
  const spam = Number(row?.spam ?? 0) || 0
  return {
    samples,
    inbox_rate: samples > 0 ? inbox / samples : 0,
    spam_rate: samples > 0 ? spam / samples : 0,
  }
}

