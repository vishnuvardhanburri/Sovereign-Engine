import { query } from '@/lib/db'
import { closeRedis, getQueueLength, removeQueueJobsForContact } from '@/lib/redis'
import { emitEvent } from '@/lib/events'

const BLOCKLIST_KEY_PREFIX = 'contact:blocked:'

export async function cancelContactQueue(contactEmail: string): Promise<void> {
  const normalized = contactEmail.trim().toLowerCase()
  if (!normalized) {
    return
  }

  const contactResult = await query<{ id: number; client_id: number }>(
    `SELECT id, client_id FROM contacts WHERE email = $1 LIMIT 1`,
    [normalized]
  )
  const contact = contactResult.rows[0] ?? null

  if (contact) {
    await query(
      `UPDATE contacts
       SET status = 'replied', updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1 AND email = $2`,
      [contact.client_id, normalized]
    )
  }

  if (contact) {
    await removeQueueJobsForContact(contact.id)
  }

  await emitEvent({
    event_type: 'REPLY_CLASSIFIED',
    source_agent: 'reply_agent',
    payload: {
      contact_email: normalized,
      reply_type: 'INTERESTED',
      action: 'STOP_SEQUENCE',
    },
  })

  await query(
    `INSERT INTO operator_actions (client_id, campaign_id, action_type, summary, payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      contact?.client_id ?? 0,
      null,
      'cancel_contact_queue',
      `Cancelled future sends for ${normalized}`,
      { contact_email: normalized, blocked_key: `${BLOCKLIST_KEY_PREFIX}${normalized}` },
    ]
  )
}

export async function restartQueueIfStuck(): Promise<void> {
  const length = await getQueueLength()
  if (length > 0) {
    return
  }

  await closeRedis()
}
