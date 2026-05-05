import { queryOne } from '@/lib/db'

export interface ComplianceResult {
  allowed: boolean
  reason: string
  suppressedCount?: number
}

export async function validateCompliance(input: {
  clientId: number
  recipientEmails: string[]
}): Promise<ComplianceResult> {
  if (input.recipientEmails.length === 0) {
    return {
      allowed: true,
      reason: 'no recipients to validate',
      suppressedCount: 0,
    }
  }

  const suppressed = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM suppression_list
     WHERE client_id = $1
       AND email = ANY($2::text[])`,
    [input.clientId, input.recipientEmails]
  )

  const suppressedCount = Number(suppressed?.count ?? '0')
  if (suppressedCount > 0) {
    return {
      allowed: false,
      reason: `${suppressedCount} recipients are suppressed`,
      suppressedCount,
    }
  }

  return {
    allowed: true,
    reason: 'all recipients are compliant',
    suppressedCount: 0,
  }
}
