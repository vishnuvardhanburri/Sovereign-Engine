import type { DbExecutor } from '@sovereign/types'

export type ReplyClassification =
  | { kind: 'positive'; reason: string }
  | { kind: 'negative'; reason: string }
  | { kind: 'unsubscribe'; reason: string }
  | { kind: 'unknown'; reason: string }

const POSITIVE = ['yes', 'sounds good', 'interested', 'let’s talk', 'lets talk', 'book', 'calendar', 'meeting', 'call', 'available']
const NEGATIVE = ['not interested', 'no thanks', 'stop', 'go away', 'don’t contact', "don't contact", 'remove me']
const UNSUB = ['unsubscribe', 'opt out', 'opt-out']

export function classifyReply(text: string): ReplyClassification {
  const body = String(text || '').toLowerCase()
  if (UNSUB.some((k) => body.includes(k))) return { kind: 'unsubscribe', reason: 'keyword_unsubscribe' }
  if (NEGATIVE.some((k) => body.includes(k))) return { kind: 'negative', reason: 'keyword_negative' }
  if (POSITIVE.some((k) => body.includes(k))) return { kind: 'positive', reason: 'keyword_positive' }
  return { kind: 'unknown', reason: 'no_signal' }
}

export async function applyReplyOutcome(input: {
  db: DbExecutor
  clientId: number
  contactId: number
  contactEmail: string
  classification: ReplyClassification
  bookingLink?: string | null
}): Promise<{ action: 'tag_interested' | 'suppress' | 'noop'; meetingRequested: boolean }> {
  const { db, clientId, contactId, contactEmail, classification } = input

  if (classification.kind === 'positive') {
    await db(
      `UPDATE contacts
       SET status = 'replied', updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1 AND id = $2`,
      [clientId, contactId]
    )

    // Best-effort "meeting requested" marker via operator_actions (no schema change required).
    if (input.bookingLink) {
      await db(
        `INSERT INTO operator_actions (client_id, campaign_id, action_type, summary, payload)
         VALUES ($1, NULL, $2, $3, $4::jsonb)`,
        [
          clientId,
          'meeting_requested',
          'Meeting requested from positive reply',
          JSON.stringify({ contactId, email: contactEmail, bookingLink: input.bookingLink }),
        ]
      ).catch(() => {})
      return { action: 'tag_interested', meetingRequested: true }
    }

    return { action: 'tag_interested', meetingRequested: false }
  }

  if (classification.kind === 'unsubscribe' || classification.kind === 'negative') {
    await db(
      `INSERT INTO suppression_list (client_id, email, reason, source)
       VALUES ($1, $2, $3, 'reply_handler')
       ON CONFLICT DO NOTHING`,
      [clientId, String(contactEmail).trim().toLowerCase(), 'unsubscribed']
    )
    await db(
      `UPDATE contacts
       SET status = 'unsubscribed', unsubscribed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1 AND id = $2`,
      [clientId, contactId]
    )
    return { action: 'suppress', meetingRequested: false }
  }

  return { action: 'noop', meetingRequested: false }
}

