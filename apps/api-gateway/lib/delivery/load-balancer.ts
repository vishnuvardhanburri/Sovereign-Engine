import { query } from '@/lib/db'

export interface LoadBalancerSelection {
  identity_id: number
  domain_id: number
  identity_email: string
  domain: string
  reason: string
}

export interface LoadBalancerConstraints {
  per_inbox_daily_cap?: number
  per_domain_daily_cap?: number
  min_seconds_between_identity_sends?: number
  lane?: 'normal' | 'low_risk' | 'slow'
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export async function selectSenderIdentity(
  clientId: number,
  constraints: LoadBalancerConstraints = {}
): Promise<LoadBalancerSelection | null> {
  const lane = constraints.lane ?? 'normal'
  const perInboxCap =
    constraints.per_inbox_daily_cap ?? (lane === 'slow' ? 30 : lane === 'low_risk' ? 60 : 350)
  const perDomainCap =
    constraints.per_domain_daily_cap ?? (lane === 'slow' ? 500 : lane === 'low_risk' ? 3000 : 20000)
  const minGap =
    constraints.min_seconds_between_identity_sends ?? (lane === 'slow' ? 180 : lane === 'low_risk' ? 120 : 60)

  const extraDomainFilters =
    lane === 'low_risk'
      ? `AND d.spf_valid = TRUE AND d.dkim_valid = TRUE AND d.dmarc_valid = TRUE
         AND d.health_score >= 80
         AND d.bounce_rate <= 1.5
         AND d.spam_rate <= 0.0200`
      : lane === 'slow'
        ? `AND d.spf_valid = TRUE AND d.dkim_valid = TRUE AND d.dmarc_valid = TRUE
           AND d.health_score >= 85
           AND d.bounce_rate <= 1.0
           AND d.spam_rate <= 0.0150`
        : `AND d.health_score >= 30`

  // Pick a healthy domain + identity, avoid spikes via last_sent_at and daily counters.
  const rows = await query<{
    identity_id: number
    domain_id: number
    identity_email: string
    domain: string
    identity_sent_today: number
    domain_sent_today: number
    last_sent_at: string | null
    health_score: number
    bounce_rate: number
  }>(
    `
    SELECT
      i.id AS identity_id,
      d.id AS domain_id,
      i.email AS identity_email,
      d.domain AS domain,
      i.sent_today AS identity_sent_today,
      d.sent_today AS domain_sent_today,
      i.last_sent_at AS last_sent_at,
      d.health_score AS health_score,
      d.bounce_rate AS bounce_rate
    FROM identities i
    JOIN domains d ON d.id = i.domain_id
    WHERE i.client_id = $1
      AND d.client_id = $1
      AND i.status = 'active'
      AND d.status = 'active'
      AND i.sent_today < LEAST(i.daily_limit, $2)
      AND d.sent_today < LEAST(d.daily_limit, $3)
      ${extraDomainFilters}
    ORDER BY
      d.health_score DESC,
      d.bounce_rate ASC,
      i.sent_today ASC,
      COALESCE(i.last_sent_at, '1970-01-01'::timestamp) ASC
    LIMIT 50
    `,
    [clientId, perInboxCap, perDomainCap]
  )

  const candidates = rows.rows.filter((r) => {
    if (!r.last_sent_at) return true
    return (Date.now() - new Date(r.last_sent_at).getTime()) >= minGap * 1000
  })

  if (candidates.length === 0) {
    return null
  }

  // Rotate top 5 to avoid hammering a single inbox.
  const top = candidates.slice(0, Math.min(5, candidates.length))
  const pick = top[Math.abs((Date.now() / 60000) | 0) % top.length] ?? top[0]!

  return {
    identity_id: pick.identity_id,
    domain_id: pick.domain_id,
    identity_email: pick.identity_email,
    domain: pick.domain,
    reason: `health=${clamp(Number(pick.health_score) || 0, 0, 100)} sent_today(identity=${pick.identity_sent_today},domain=${pick.domain_sent_today})`,
  }
}
