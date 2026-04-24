import type { DbExecutor, Lane, SendIdentitySelection } from '@xavira/types'
// Import default to stay compatible across tsx/ESM boundaries.
import LIMITS from '../../../configs/limits/default.ts'

export interface SendingDeps {
  db: DbExecutor
}

export async function rotateInbox(deps: SendingDeps, clientId: number, lane: Lane): Promise<SendIdentitySelection | null> {
  // Adapter-mode implementation: reuse the exact SQL selection policy we already used in api-gateway/lib/delivery/load-balancer.ts,
  // but keep this service independent of apps/*.
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
      ${extraDomainFilters}
    ORDER BY
      d.health_score DESC,
      d.bounce_rate ASC,
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
