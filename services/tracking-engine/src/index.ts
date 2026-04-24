import type { DbExecutor, TrackingIngestEvent } from '@xavira/types'

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
  const metadata = event.metadata ?? {}

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
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, COALESCE($10, CURRENT_TIMESTAMP))`,
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

