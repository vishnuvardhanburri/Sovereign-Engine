import { query, queryOne } from '@/lib/db'
import { Domain } from '@/lib/db/types'

export type DomainRiskDecision = 'pause' | 'cooldown' | 'normal'

export function assessDomainRisk(domain: Domain): DomainRiskDecision {
  if (!domain.spf_valid || !domain.dkim_valid || !domain.dmarc_valid) {
    return 'pause'
  }

  if (domain.bounce_rate > 5) {
    return 'pause'
  }

  if (domain.health_score < 50) {
    return 'cooldown'
  }

  return 'normal'
}

export async function recalculateDomainHealth(
  clientId: number,
  domainId: number
): Promise<Domain | null> {
  const domain = await queryOne<Domain>(
    `SELECT *
     FROM domains
     WHERE client_id = $1 AND id = $2`,
    [clientId, domainId]
  )

  if (!domain) {
    return null
  }

  const bounceRate =
    domain.sent_count > 0
      ? Number(((domain.bounce_count / domain.sent_count) * 100).toFixed(2))
      : 0
  const healthScore = Math.min(Math.max(Math.round(100 - bounceRate * 8), 0), 100)
  const nextStatus = bounceRate > 5 ? 'paused' : domain.status

  return queryOne<Domain>(
    `UPDATE domains
     SET bounce_rate = $3,
         health_score = $4,
         status = $5,
         updated_at = CURRENT_TIMESTAMP
     WHERE client_id = $1 AND id = $2
     RETURNING *`,
    [clientId, domainId, bounceRate, healthScore, nextStatus]
  )
}

export async function refreshDomainRiskLimits(clientId?: number) {
  const params: unknown[] = []
  let where = ''

  if (clientId) {
    params.push(clientId)
    where = 'WHERE client_id = $1'
  }

  const domains = await query<Domain>(
    `SELECT *
     FROM domains
     ${where}`,
    params
  )

  for (const domain of domains.rows) {
    const identityCountRow = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM identities
       WHERE client_id = $1
         AND domain_id = $2
         AND status = 'active'`,
      [domain.client_id, domain.id]
    )

    const identityCount = Math.max(Number(identityCountRow?.count ?? 0), 1)
    const warmupStage = Math.min(Math.max(Number(domain.warmup_stage ?? 1), 1), 7)
    const stageLimits = [20, 50, 100, 200, 400, 800, 1000]
    const warmupBudget = stageLimits[warmupStage - 1] ?? 20
    const perIdentityLimit = Math.min(500, warmupBudget)
    const domainLimit = Math.min(1000, identityCount * perIdentityLimit)

    await query(
      `UPDATE domains
       SET daily_limit = $3,
           warmup_stage = CASE
             WHEN status = 'warming' AND bounce_rate <= 2 THEN LEAST(warmup_stage + 1, 7)
             ELSE warmup_stage
           END,
           status = CASE
             WHEN NOT (spf_valid AND dkim_valid AND dmarc_valid) THEN 'paused'
             WHEN bounce_rate > 5 THEN 'paused'
             WHEN status = 'paused' AND bounce_rate <= 5 THEN 'active'
             ELSE status
           END,
           updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1 AND id = $2`,
      [domain.client_id, domain.id, domainLimit]
    )

    await recalculateDomainHealth(domain.client_id, domain.id)
  }

  return { domainsProcessed: domains.rowCount }
}
export interface RiskSignals {
  anomalyDetected: boolean
  reason: string
  suspiciousDomainCount: number
}

export async function detectRisk(clientId: number): Promise<RiskSignals> {
  const row = await queryOne<{
    average_bounce_rate: string
    average_health_score: string
    paused_domains: string
    recent_failed: string
  }>(
    `SELECT
       COALESCE(AVG(domains.bounce_rate)::text, '0') AS average_bounce_rate,
       COALESCE(AVG(domains.health_score)::text, '0') AS average_health_score,
       COALESCE(SUM(CASE WHEN domains.status = 'paused' THEN 1 ELSE 0 END)::text, '0') AS paused_domains,
       COALESCE(SUM(CASE WHEN events.event_type = 'failed' THEN 1 ELSE 0 END)::text, '0') AS recent_failed
     FROM domains
     LEFT JOIN events ON domains.client_id = events.client_id
     WHERE domains.client_id = $1`,
    [clientId]
  )

  const bounceRate = Number(row?.average_bounce_rate ?? '0')
  const healthScore = Number(row?.average_health_score ?? '0')
  const pausedDomains = Number(row?.paused_domains ?? '0')
  const recentFailed = Number(row?.recent_failed ?? '0')
  const anomalyDetected = bounceRate > 4 || healthScore < 60 || recentFailed > 20
  let reason = 'system is stable'

  if (bounceRate > 4) {
    reason = 'bounce rate is elevated'
  } else if (healthScore < 60) {
    reason = 'domain health is degrading'
  } else if (recentFailed > 20) {
    reason = 'delivery failures are increasing'
  }

  return {
    anomalyDetected,
    reason,
    suspiciousDomainCount: pausedDomains,
  }
}