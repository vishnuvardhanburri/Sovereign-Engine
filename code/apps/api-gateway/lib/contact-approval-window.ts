import { query } from '@/lib/db'

const FALLBACK_REVIEW_WINDOW = 5
const SYSTEM_APPROVAL_CEILING = Math.max(
  1,
  Math.min(Number(process.env.CONTACT_APPROVAL_MAX_WINDOW ?? 100), 800)
)

export type SystemApprovalWindow = {
  limit: number
  activeDomains: number
  healthyDomains?: number
  remainingCapacity: number
  senderRemainingCapacity?: number
  eligibleSenderIdentities?: number
  averageHealthScore: number
  maxBounceRate?: number
  policy: 'fallback_review_window' | 'domain_capacity_health_window'
}

export async function resolveSystemApprovalWindow(clientId: number): Promise<SystemApprovalWindow> {
  const row = await query<{
    active_domains: string
    healthy_domains: string
    remaining_capacity: string
    sender_remaining_capacity: string
    eligible_sender_identities: string
    average_health_score: string
    max_bounce_rate: string
  }>(
    `WITH domain_base AS (
       SELECT
         d.*,
         GREATEST(0, LEAST(100, ROUND(100 - ((COALESCE(d.bounce_count, 0)::numeric / GREATEST(COALESCE(d.sent_count, 0) + 25, 1)) * 100 * 8)))) AS computed_health_score,
         CASE
           WHEN COALESCE(d.sent_count, 0) > 0 THEN (COALESCE(d.bounce_count, 0)::numeric / NULLIF(d.sent_count, 0)) * 100
           ELSE 0
         END AS raw_bounce_rate
       FROM domains d
       WHERE d.client_id = $1
         AND d.status = 'active'
         AND d.paused = false
     ),
     domain_rows AS (
       SELECT
         *,
         (((COALESCE(sent_count, 0) >= 20) OR (COALESCE(bounce_count, 0) >= 3)) AND raw_bounce_rate > 5) AS proven_bounce_pressure
       FROM domain_base
     ),
     domain_signal AS (
       SELECT
         COUNT(*)::text AS active_domains,
         COUNT(*) FILTER (
           WHERE computed_health_score >= 30
             AND NOT proven_bounce_pressure
         )::text AS healthy_domains,
         COALESCE(SUM(GREATEST(COALESCE(daily_cap, daily_limit) - sent_today, 0)), 0)::text AS remaining_capacity,
         COALESCE(AVG(computed_health_score), 100)::text AS average_health_score,
         COALESCE(MAX(raw_bounce_rate), 0)::text AS max_bounce_rate
       FROM domain_rows
     ),
     sender_signal AS (
       SELECT
         COUNT(i.id)::text AS eligible_sender_identities,
         COALESCE(
           SUM(
             LEAST(
               GREATEST(i.daily_limit - i.sent_today, 0),
               GREATEST(COALESCE(d.daily_cap, d.daily_limit) - d.sent_today, 0)
             )
           ),
           0
         )::text AS sender_remaining_capacity
       FROM domain_rows d
       JOIN identities i ON i.domain_id = d.id AND i.client_id = d.client_id
       WHERE i.status = 'active'
         AND d.computed_health_score >= 30
         AND NOT d.proven_bounce_pressure
         AND i.sent_today < i.daily_limit
         AND d.sent_today < COALESCE(d.daily_cap, d.daily_limit)
     )
     SELECT
       domain_signal.active_domains,
       domain_signal.healthy_domains,
       domain_signal.remaining_capacity,
       sender_signal.sender_remaining_capacity,
       sender_signal.eligible_sender_identities,
       domain_signal.average_health_score,
       domain_signal.max_bounce_rate
     FROM domain_signal
     CROSS JOIN sender_signal`,
    [clientId]
  )

  const signal = row.rows[0]
  const activeDomains = Number(signal?.active_domains ?? 0)
  const healthyDomains = Number(signal?.healthy_domains ?? 0)
  const remainingCapacity = Number(signal?.remaining_capacity ?? 0)
  const senderRemainingCapacity = Number(signal?.sender_remaining_capacity ?? 0)
  const eligibleSenderIdentities = Number(signal?.eligible_sender_identities ?? 0)
  const averageHealthScore = Number(signal?.average_health_score ?? 100)
  const maxBounceRate = Number(signal?.max_bounce_rate ?? 0)

  if (activeDomains === 0 || remainingCapacity <= 0) {
    return {
      limit: FALLBACK_REVIEW_WINDOW,
      activeDomains,
      healthyDomains,
      remainingCapacity,
      senderRemainingCapacity,
      eligibleSenderIdentities,
      averageHealthScore,
      maxBounceRate,
      policy: 'fallback_review_window',
    }
  }

  const reviewPercent = averageHealthScore >= 90 ? 0.2 : averageHealthScore >= 75 ? 0.1 : 0.05
  const computed = Math.floor(remainingCapacity * reviewPercent)
  const limit = Math.max(1, Math.min(SYSTEM_APPROVAL_CEILING, Math.max(FALLBACK_REVIEW_WINDOW, computed)))

  return {
    limit,
    activeDomains,
    healthyDomains,
    remainingCapacity,
    senderRemainingCapacity,
    eligibleSenderIdentities,
    averageHealthScore,
    maxBounceRate,
    policy: 'domain_capacity_health_window',
  }
}
