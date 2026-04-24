import { queryOne } from '@/lib/db'

export interface DomainHealth {
  domainId: number | null
  domain: string | null
  healthScore: number
  bounceRate: number
  domainCount: number
  pausedDomains: number
}

export async function evaluateDomainHealth(clientId: number): Promise<DomainHealth> {
  const row = await queryOne<{
    average_health_score: string
    average_bounce_rate: string
    domain_count: string
    paused_domains: string
    worst_domain_id: string
    worst_domain: string | null
  }>(
    `SELECT
       COALESCE(AVG(health_score)::text, '0') AS average_health_score,
       COALESCE(AVG(bounce_rate)::text, '0') AS average_bounce_rate,
       COALESCE(COUNT(*)::text, '0') AS domain_count,
       COALESCE(SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END)::text, '0') AS paused_domains,
       COALESCE((SELECT id FROM domains WHERE client_id = $1 ORDER BY health_score ASC LIMIT 1)::text, '0') AS worst_domain_id,
       (SELECT domain FROM domains WHERE client_id = $1 ORDER BY health_score ASC LIMIT 1) AS worst_domain
     FROM domains
     WHERE client_id = $1`,
    [clientId]
  )

  return {
    domainId: Number(row?.worst_domain_id ?? '0') || null,
    domain: row?.worst_domain ?? null,
    healthScore: Number(row?.average_health_score ?? '0'),
    bounceRate: Number(row?.average_bounce_rate ?? '0'),
    domainCount: Number(row?.domain_count ?? '0'),
    pausedDomains: Number(row?.paused_domains ?? '0'),
  }
}
