import { query } from '@/lib/db'

export async function hasBeenContactedRecently(input: {
  clientId: number
  contactId: number
  withinDays?: number
}): Promise<boolean> {
  const days = Math.max(1, Math.min(365, input.withinDays ?? 30))
  const result = await query(
    `
    SELECT 1
    FROM events
    WHERE client_id = $1
      AND contact_id = $2
      AND event_type IN ('sent','delivered','opened','clicked','reply')
      AND created_at > NOW() - ($3::text)::interval
    LIMIT 1
    `,
    [input.clientId, input.contactId, `${days} days`]
  )
  return result.rows.length > 0
}

export async function blockFutureContact(input: {
  clientId: number
  contactId: number
  reason: string
}): Promise<void> {
  await query(
    `UPDATE contacts
     SET status = 'replied', updated_at = CURRENT_TIMESTAMP
     WHERE client_id = $1 AND id = $2`,
    [input.clientId, input.contactId]
  )
  await query(
    `INSERT INTO operator_actions (client_id, campaign_id, action_type, summary, payload)
     VALUES ($1, NULL, 'contact_blocked', $2, $3)`,
    [input.clientId, `Blocked contact ${input.contactId}`, { contact_id: input.contactId, reason: input.reason }]
  )
}

