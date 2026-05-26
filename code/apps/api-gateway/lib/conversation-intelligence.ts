import { queryOne } from '@/lib/db'
import { classifyReplyDeterministically } from '@/lib/local-ai/deterministic-fallback'
import { appendOperationalEvent } from '@/lib/operational-events'

interface ContactLookupRow {
  id: string
}

export async function recordConversationIntelligence(input: {
  clientId: number
  fromEmail: string
  subject?: string | null
  body?: string | null
  messageId?: string | null
}) {
  const contact = await queryOne<ContactLookupRow>(
    `SELECT id::text
     FROM contacts
     WHERE client_id = $1 AND lower(email) = lower($2)
     LIMIT 1`,
    [input.clientId, input.fromEmail]
  )
  const analysis = classifyReplyDeterministically({ subject: input.subject, body: input.body })
  const row = await queryOne<{ id: string }>(
    `INSERT INTO conversation_intelligence (
       client_id,
       contact_id,
       message_id,
       from_email,
       subject,
       classification,
       sentiment,
       opportunity_score,
       recommended_action,
       evidence
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     ON CONFLICT (client_id, message_id) WHERE message_id IS NOT NULL DO UPDATE
     SET classification = EXCLUDED.classification,
         sentiment = EXCLUDED.sentiment,
         opportunity_score = EXCLUDED.opportunity_score,
         recommended_action = EXCLUDED.recommended_action,
         evidence = EXCLUDED.evidence,
         updated_at = now()
     RETURNING id::text`,
    [
      input.clientId,
      contact?.id ?? null,
      input.messageId ?? null,
      input.fromEmail,
      input.subject ?? null,
      analysis.classification,
      analysis.sentiment,
      analysis.opportunityScore,
      analysis.recommendedAction,
      JSON.stringify({ terms: analysis.evidence }),
    ]
  )

  await appendOperationalEvent({
    clientId: input.clientId,
    eventType: 'conversation.reply_classified',
    aggregateType: 'conversation',
    aggregateId: row?.id ?? input.messageId ?? input.fromEmail,
    payload: {
      fromEmail: input.fromEmail,
      classification: analysis.classification,
      sentiment: analysis.sentiment,
      opportunityScore: analysis.opportunityScore,
      recommendedAction: analysis.recommendedAction,
    },
  })

  return { id: row?.id, ...analysis }
}
