import type { DbExecutor, Lane, SendIdentitySelection } from '@sovereign/types'
// Import default to stay compatible across tsx/ESM boundaries.
import LIMITS from '../../../configs/limits/default'

export interface SendingDeps {
  db: DbExecutor
}

export async function rotateInbox(deps: SendingDeps, clientId: number, lane: Lane): Promise<SendIdentitySelection | null> {
  // Adapter-mode implementation: reuse the exact SQL selection policy we already used in api-gateway/lib/delivery/load-balancer.ts,
  // but keep this service independent of apps/*.
  const computedHealthSql = `GREATEST(0, LEAST(100, ROUND(100 - ((COALESCE(d.bounce_count, 0)::numeric / GREATEST(COALESCE(d.sent_count, 0) + 25, 1)) * 100 * 8))))`
  const rawBounceSql = `CASE WHEN COALESCE(d.sent_count, 0) > 0 THEN (COALESCE(d.bounce_count, 0)::numeric / NULLIF(d.sent_count, 0)) * 100 ELSE 0 END`
  const provenBounceBlock = `NOT (((COALESCE(d.sent_count, 0) >= 20) OR (COALESCE(d.bounce_count, 0) >= 3)) AND ${rawBounceSql} > 5)`
  const extraDomainFilters =
    lane === 'low_risk'
      ? `AND d.spf_valid = TRUE AND d.dkim_valid = TRUE AND d.dmarc_valid = TRUE
         AND ${computedHealthSql} >= 80
         AND ${rawBounceSql} <= 1.5
         AND ${provenBounceBlock}
         AND d.spam_rate <= 0.0200`
      : lane === 'slow'
        ? `AND d.spf_valid = TRUE AND d.dkim_valid = TRUE AND d.dmarc_valid = TRUE
           AND ${computedHealthSql} >= 85
           AND ${rawBounceSql} <= 1.0
           AND ${provenBounceBlock}
           AND d.spam_rate <= 0.0150`
        : `AND ${computedHealthSql} >= 30
           AND ${provenBounceBlock}`

  const res = await deps.db<any>(
    `
    SELECT
      row_to_json(i.*) AS identity,
      row_to_json(d.*) AS domain
    FROM identities i
    JOIN domains d ON d.id = i.domain_id
    WHERE i.client_id = $1
      AND d.client_id = $1
      AND i.status = 'active'
      AND d.status = 'active'
      AND d.paused = FALSE
      AND i.sent_today < i.daily_limit
      AND d.sent_today < COALESCE(d.daily_cap, d.daily_limit)
      AND COALESCE(d.daily_cap, d.daily_limit) > 0
      ${extraDomainFilters}
    ORDER BY
      ${computedHealthSql} DESC,
      ${rawBounceSql} ASC,
      i.sent_today ASC,
      COALESCE(i.last_sent_at, '1970-01-01'::timestamp) ASC
    LIMIT 50
    `,
    [clientId]
  )

  const rows = res.rows as Array<{ identity: any; domain: any }>
  if (!rows.length) return null

  // rotate top 5
  const top = rows.slice(0, Math.min(5, rows.length))
  const pick = top[Math.abs((Date.now() / 60000) | 0) % top.length] ?? top[0]!
  return { identity: pick.identity, domain: pick.domain }
}

export function enforceCaps(selection: SendIdentitySelection, lane: Lane): { ok: true } | { ok: false; reason: string } {
  // No static caps here. Adaptive throughput control is enforced in the sender worker (per-domain limiter),
  // which can throttle or pause domains based on observed bounce/reply signals.
  return { ok: true }
}

export function scheduleSend(now = Date.now(), lane: Lane): Date {
  const [minMs, maxMs] = LIMITS.sendIntervalMs
  const jitter = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs
  const laneFactor = lane === 'slow' ? 2.5 : lane === 'low_risk' ? 1.5 : 1
  return new Date(now + Math.floor(jitter * laneFactor))
}
