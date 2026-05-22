import { query } from '@/lib/db'

const DEFAULT_FALLBACK_REVIEW_WINDOW = 1_000
const DEFAULT_APPROVAL_INVENTORY_WINDOW = 1_000_000
const ABSOLUTE_APPROVAL_CEILING = 1_000_000

function envInteger(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name])
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(Math.trunc(value), max))
}

function approvalConfig() {
  const fallbackReviewWindow = envInteger(
    'CONTACT_APPROVAL_FALLBACK_WINDOW',
    DEFAULT_FALLBACK_REVIEW_WINDOW,
    1,
    ABSOLUTE_APPROVAL_CEILING
  )
  const inventoryWindow = envInteger(
    'CONTACT_APPROVAL_INVENTORY_WINDOW',
    DEFAULT_APPROVAL_INVENTORY_WINDOW,
    1,
    ABSOLUTE_APPROVAL_CEILING
  )
  const ceiling = envInteger(
    'CONTACT_APPROVAL_MAX_WINDOW',
    Math.max(inventoryWindow, 2_000),
    1,
    ABSOLUTE_APPROVAL_CEILING
  )

  return {
    fallbackReviewWindow: Math.min(fallbackReviewWindow, ceiling),
    inventoryWindow: Math.min(inventoryWindow, ceiling),
    ceiling,
  }
}

export function computeSystemApprovalLimit(input: {
  activeDomains: number
  remainingCapacity: number
  senderRemainingCapacity?: number
  averageHealthScore: number
}): number {
  const config = approvalConfig()
  const senderCapacity = Math.max(0, Math.trunc(input.senderRemainingCapacity ?? 0))
  const domainCapacity = Math.max(0, Math.trunc(input.remainingCapacity))

  // Approval is an inventory/research gate, not the final send gate. Keep the
  // backlog large enough for autonomous verification while send capacity remains
  // controlled later by the queue planner.
  if (input.activeDomains === 0 || Math.max(senderCapacity, domainCapacity) <= 0) {
    return config.fallbackReviewWindow
  }

  const healthFloor =
    input.averageHealthScore <= 30
      ? config.fallbackReviewWindow
      : config.inventoryWindow
  const capacityBacklog = Math.floor(Math.max(senderCapacity, domainCapacity) * 2)
  const computed = Math.max(config.fallbackReviewWindow, healthFloor, capacityBacklog)

  return Math.max(1, Math.min(config.ceiling, computed))
}

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

function capacityHealthWindowSql(): string {
  const raw = process.env.DOMAIN_CAPACITY_HEALTH_WINDOW ?? 'today'
  return raw.trim().toLowerCase() === '24h' ? "NOW() - INTERVAL '24 hours'" : 'CURRENT_DATE'
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
    `WITH recent_events AS (
       SELECT
         domain_id,
         COUNT(*) FILTER (WHERE event_type = 'sent') AS recent_sent_count,
         COUNT(*) FILTER (WHERE event_type = 'bounce') AS recent_bounce_count
       FROM events
       WHERE client_id = $1
         AND domain_id IS NOT NULL
         AND created_at >= ${capacityHealthWindowSql()}
         AND event_type IN ('sent', 'bounce')
       GROUP BY domain_id
     ),
     domain_base AS (
       SELECT
         d.*,
         COALESCE(re.recent_sent_count, 0) AS capacity_sent_count,
         COALESCE(re.recent_bounce_count, 0) AS capacity_bounce_count,
         GREATEST(0, LEAST(100, ROUND(100 - ((COALESCE(re.recent_bounce_count, 0)::numeric / GREATEST(COALESCE(re.recent_sent_count, 0) + 25, 1)) * 100 * 8)))) AS computed_health_score,
         CASE
           WHEN COALESCE(re.recent_sent_count, 0) > 0 THEN (COALESCE(re.recent_bounce_count, 0)::numeric / NULLIF(re.recent_sent_count, 0)) * 100
           ELSE 0
         END AS raw_bounce_rate
       FROM domains d
       LEFT JOIN recent_events re ON re.domain_id = d.id
       WHERE d.client_id = $1
         AND d.status = 'active'
         AND d.paused = false
     ),
     domain_rows AS (
       SELECT
         *,
         (((COALESCE(capacity_sent_count, 0) >= 20) OR (COALESCE(capacity_bounce_count, 0) >= 3)) AND raw_bounce_rate > 5) AS proven_bounce_pressure,
         (
           COALESCE(daily_cap, 0) > 0
           AND GREATEST(COALESCE(daily_cap, daily_limit) - sent_today, 0) > 0
           AND computed_health_score >= 30
           AND raw_bounce_rate <= 35
         ) AS recovery_lane_eligible
       FROM domain_base
     ),
     domain_signal AS (
       SELECT
         COUNT(*)::text AS active_domains,
         COUNT(*) FILTER (
           WHERE computed_health_score >= 30
             AND (NOT proven_bounce_pressure OR recovery_lane_eligible)
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
         AND (NOT d.proven_bounce_pressure OR d.recovery_lane_eligible)
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
      limit: computeSystemApprovalLimit({
        activeDomains,
        remainingCapacity,
        senderRemainingCapacity,
        averageHealthScore,
      }),
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

  const limit = computeSystemApprovalLimit({
    activeDomains,
    remainingCapacity,
    senderRemainingCapacity,
    averageHealthScore,
  })

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
