import type { DbExecutor, TrackingIngestEvent } from '@xavira/types'
import crypto from 'crypto'

export interface TrackingDeps {
  db: DbExecutor
  onEmitted?: (event: TrackingIngestEvent) => void | Promise<void>
}

function toLegacyEventType(type: TrackingIngestEvent['type']): 'sent' | 'failed' | 'bounce' | 'reply' {
  switch (type) {
    case 'SENT':
      return 'sent'
    case 'FAILED':
      return 'failed'
    case 'BOUNCED':
      return 'bounce'
    case 'REPLIED':
      return 'reply'
  }
}

export async function ingestEvent(deps: TrackingDeps, event: TrackingIngestEvent): Promise<void> {
  const legacyType = toLegacyEventType(event.type)
  const metadata = { ...(event.metadata ?? {}) } as Record<string, unknown>

  // Idempotency: stable event id to avoid duplicate rows on retries.
  // Dedupe key is (client_id, metadata.event_id).
  if (!metadata.event_id) {
    // Prefer queue_job_id based idempotency when available (immune to clock skew).
    // Fall back to a time-bucketed id when queue_job_id is missing (e.g. webhook noise).
    const base = [event.clientId, legacyType, event.providerMessageId ?? ''].join('|')
    const payload =
      event.queueJobId
        ? `${base}|qj:${event.queueJobId}`
        : (() => {
            const ts = event.occurredAt ? new Date(event.occurredAt).getTime() : Date.now()
            const bucket = Math.floor(ts / (5 * 60_000))
            return `${base}|bucket:${bucket}`
          })()
    metadata.event_id = crypto.createHash('sha256').update(payload).digest('hex').slice(0, 32)
  }

  await deps.db(
    `INSERT INTO events (
      client_id,
      campaign_id,
      contact_id,
      identity_id,
      domain_id,
      queue_job_id,
      event_type,
      provider_message_id,
      metadata,
      created_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, COALESCE($10, CURRENT_TIMESTAMP))
    ON CONFLICT DO NOTHING`,
    [
      event.clientId,
      event.campaignId ?? null,
      event.contactId ?? null,
      event.identityId ?? null,
      event.domainId ?? null,
      event.queueJobId ?? null,
      legacyType,
      event.providerMessageId ?? null,
      metadata,
      event.occurredAt ?? null,
    ]
  )

  if (deps.onEmitted) {
    await deps.onEmitted(event)
  }
}
