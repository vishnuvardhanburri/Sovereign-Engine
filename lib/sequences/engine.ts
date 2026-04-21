import { shouldStopSequence } from '@/lib/production-fixes'
import { query } from '@/lib/db'

export interface SequenceEngineDecision {
  stop: boolean
  reason?: string
}

export async function evaluateSequenceStep(input: {
  clientId: number
  contactId: number
  campaignId: number
}): Promise<SequenceEngineDecision> {
  if (await shouldStopSequence(input.clientId, input.contactId, input.campaignId)) {
    return { stop: true, reason: 'reply_received' }
  }

  const suppressed = await query(`SELECT 1 FROM suppression_list WHERE client_id = $1 AND email IN (SELECT email FROM contacts WHERE id = $2) LIMIT 1`, [
    input.clientId,
    input.contactId,
  ])
  if (suppressed.rows.length > 0) {
    return { stop: true, reason: 'suppressed' }
  }

  return { stop: false }
}

