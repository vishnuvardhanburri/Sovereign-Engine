import { query } from '@/lib/db'

export interface DomainSelection {
  domainId: number
  domain: string
  healthScore: number
  bounceRate: number
  dailyLimit: number
  ageDays: number
}

export async function selectHealthyDomain(
  clientId: number,
  campaignId: number,
  excludeDomainIds: number[] = []
): Promise<DomainSelection | null> {
  const rows = await query<{
    id: number
    domain: string
    health_score: string
    bounce_rate: string
    daily_limit: string
    age_days: string
  }>(
    `SELECT
       id,
       domain,
       COALESCE(health_score::text, '0') AS health_score,
       COALESCE(bounce_rate::text, '0') AS bounce_rate,
       COALESCE(daily_limit::text, '0') AS daily_limit,
       COALESCE(DATE_PART('day', NOW() - created_at)::text, '0') AS age_days
     FROM domains
     WHERE client_id = $1
       AND status = 'active'
       AND ($2::int[] = '{}' OR id != ALL($2))
     ORDER BY
       CASE
         WHEN health_score >= 80 THEN 0
         WHEN health_score >= 60 THEN 1
         ELSE 2
       END,
       sent_today ASC,
       bounce_rate ASC
     LIMIT 1`,
    [clientId, excludeDomainIds]
  )

  const row = rows.rows[0]
  if (!row) {
    return null
  }

  return {
    domainId: row.id,
    domain: row.domain,
    healthScore: Number(row.health_score),
    bounceRate: Number(row.bounce_rate),
    dailyLimit: Number(row.daily_limit),
    ageDays: Number(row.age_days),
  }
}
