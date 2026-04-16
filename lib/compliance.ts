import crypto from 'node:crypto'
import { appEnv } from '@/lib/env'
import { query, queryOne, transaction } from '@/lib/db'
import { Contact } from '@/lib/db/types'

function sign(payload: string) {
  return crypto
    .createHmac('sha256', appEnv.unsubscribeSecret())
    .update(payload)
    .digest('hex')
}

export function createUnsubscribeToken(input: {
  clientId: number
  contactId: number
  campaignId?: number | null
}) {
  const payload = `${input.clientId}:${input.contactId}:${input.campaignId ?? 0}`
  const signature = sign(payload)
  return Buffer.from(`${payload}:${signature}`).toString('base64url')
}

export function parseUnsubscribeToken(token: string) {
  const decoded = Buffer.from(token, 'base64url').toString('utf8')
  const [clientId, contactId, campaignId, signature] = decoded.split(':')
  const payload = `${clientId}:${contactId}:${campaignId}`

  if (!signature || sign(payload) !== signature) {
    throw new Error('Invalid unsubscribe token')
  }

  return {
    clientId: Number(clientId),
    contactId: Number(contactId),
    campaignId: Number(campaignId) || null,
  }
}

export function buildUnsubscribeUrl(input: {
  clientId: number
  contactId: number
  campaignId?: number | null
}) {
  const token = createUnsubscribeToken(input)
  return `${appEnv.appBaseUrl().replace(/\/$/, '')}/api/unsubscribe/${token}`
}

export async function markContactUnsubscribed(input: {
  clientId: number
  contactId: number
  reason?: string
  source?: string
}) {
  return transaction(async (executor) => {
    const contact = await executor<Contact>(
      `UPDATE contacts
       SET status = 'unsubscribed',
           unsubscribed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1 AND id = $2
       RETURNING *`,
      [input.clientId, input.contactId]
    )

    const row = contact.rows[0]
    if (!row) {
      return null
    }

    await executor(
      `INSERT INTO suppression_list (client_id, email, reason, source)
       VALUES ($1, $2, 'unsubscribed', $3)
       ON CONFLICT (client_id, email) DO UPDATE
       SET reason = 'unsubscribed',
           source = EXCLUDED.source`,
      [input.clientId, row.email, input.source ?? input.reason ?? 'unsubscribe']
    )

    await executor(
      `INSERT INTO events (
         client_id,
         campaign_id,
         contact_id,
         event_type,
         metadata
       )
       VALUES ($1, $2, $3, 'unsubscribed', $4)`,
      [input.clientId, null, input.contactId, { reason: input.reason ?? 'unsubscribe' }]
    )

    return row
  })
}

export async function suppressEmail(input: {
  clientId: number
  email: string
  reason: 'unsubscribed' | 'bounced' | 'duplicate' | 'complaint' | 'manual'
  source?: string | null
}) {
  await query(
    `INSERT INTO suppression_list (client_id, email, reason, source)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (client_id, email) DO UPDATE
     SET reason = EXCLUDED.reason,
         source = EXCLUDED.source`,
    [input.clientId, input.email.trim().toLowerCase(), input.reason, input.source ?? null]
  )
}

export async function findContactByProviderMessageId(providerMessageId: string) {
  return queryOne<{
    client_id: number
    contact_id: number | null
    campaign_id: number | null
    identity_id: number | null
    domain_id: number | null
    queue_job_id: number | null
  }>(
    `SELECT
       client_id,
       contact_id,
       campaign_id,
       identity_id,
       domain_id,
       queue_job_id
     FROM events
     WHERE provider_message_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [providerMessageId]
  )
}
