import { query } from '@/lib/db'
import type { Contact } from '@/lib/db/types'

export interface OutboundLead {
  contact: Contact
  score: number
  category: 'high' | 'medium' | 'low'
}

export async function selectOutboundLeads(
  clientId: number,
  limit = 100
): Promise<OutboundLead[]> {
  const result = await query<{
    id: number
    client_id: number
    email: string
    email_domain: string | null
    name: string | null
    company: string | null
    company_domain: string | null
    title: string | null
    timezone: string | null
    source: string | null
    custom_fields: Record<string, unknown>
    enrichment: Record<string, unknown> | null
    verification_status: string
    verification_sub_status: string | null
    status: string
    unsubscribed_at: string | null
    bounced_at: string | null
    created_at: string
    updated_at: string
  }>(
    `SELECT
       c.id,
       c.client_id,
       c.email,
       c.email_domain,
       c.name,
       c.company,
       c.company_domain,
       c.title,
       c.timezone,
       c.source,
       c.custom_fields,
       c.enrichment,
       c.verification_status,
       c.verification_sub_status,
       c.status,
       c.unsubscribed_at,
       c.bounced_at,
       c.created_at,
       c.updated_at
     FROM contacts c
     WHERE c.client_id = $1
       AND c.status = 'active'
       AND c.email IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM suppression_list s
         WHERE s.client_id = c.client_id
           AND s.email = c.email
       )
     ORDER BY c.created_at DESC
     LIMIT $2`,
    [clientId, limit]
  )

  return result.rows.map((row) => {
    let score = 40

    if (row.name) score += 15
    if (row.company) score += 15
    if (row.title) score += 10
    if (row.enrichment && Object.keys(row.enrichment).length > 0) score += 10

    score = Math.min(100, Math.max(0, score))
    const category = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low'

    return {
      contact: {
        id: row.id,
        client_id: row.client_id,
        email: row.email,
        email_domain: row.email_domain,
        name: row.name,
        company: row.company,
        company_domain: row.company_domain,
        title: row.title,
        timezone: row.timezone,
        source: row.source,
        custom_fields: row.custom_fields,
        enrichment: row.enrichment,
        verification_status: row.verification_status as any,
        verification_sub_status: row.verification_sub_status,
        status: row.status as any,
        unsubscribed_at: row.unsubscribed_at,
        bounced_at: row.bounced_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
      score,
      category,
    }
  })
}
