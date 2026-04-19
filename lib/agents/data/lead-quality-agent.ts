import { query } from '@/lib/db'

export interface LeadQuality {
  contactId: number
  score: number
  category: 'high' | 'medium' | 'low'
}

export async function scoreLeadQuality(clientId: number): Promise<LeadQuality[]> {
  const rows = await query<{
    id: number
    name: string | null
    company: string | null
    title: string | null
    enrichment: Record<string, unknown> | null
    status: string
  }>(
    `SELECT id, name, company, title, enrichment, status
     FROM contacts
     WHERE client_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [clientId]
  )

  return rows.rows.map((row) => {
    let score = 40
    if (row.name) score += 15
    if (row.company) score += 15
    if (row.title) score += 10
    if (row.enrichment && Object.keys(row.enrichment).length > 0) score += 10
    if (row.status === 'replied') score -= 20
    if (row.status === 'bounced' || row.status === 'unsubscribed') score -= 30

    score = Math.min(100, Math.max(0, score))
    const category = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low'

    return {
      contactId: row.id,
      score,
      category,
    }
  })
}
