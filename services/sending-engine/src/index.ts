import type { DbExecutor, Lane, SendIdentitySelection } from '@xavira/types'
import { LIMITS } from '../../../configs/limits/default'

export interface SendingDeps {
  db: DbExecutor
}

export async function rotateInbox(deps: SendingDeps, clientId: number, lane: Lane): Promise<SendIdentitySelection | null> {
  // Adapter-mode implementation: reuse the exact SQL selection policy we already used in api-gateway/lib/delivery/load-balancer.ts,
  // but keep this service independent of apps/*.
  const perInboxCap = lane === 'slow' ? LIMITS.inboxDaily : lane === 'low_risk' ? Math.max(60, LIMITS.inboxDaily) : 350
  const perDomainCap = lane === 'slow' ? 500 : lane === 'low_risk' ? 3000 : 20000

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

  const rows = res.rows as Array<{ identity: any; domain: any }>
  if (!rows.length) return null

  // rotate top 5
  const top = rows.slice(0, Math.min(5, rows.length))
  const pick = top[Math.abs((Date.now() / 60000) | 0) % top.length] ?? top[0]!
  return { identity: pick.identity, domain: pick.domain }
}

export function enforceCaps(selection: SendIdentitySelection, lane: Lane): { ok: true } | { ok: false; reason: string } {
  const identityCap = selection.identity.daily_limit ?? 0
  const domainCap = selection.domain.daily_limit ?? 0
  if (identityCap > 0 && selection.identity.sent_today >= identityCap) return { ok: false, reason: 'identity_daily_cap' }
  if (domainCap > 0 && selection.domain.sent_today >= domainCap) return { ok: false, reason: 'domain_daily_cap' }
  if (lane === 'slow' && selection.identity.sent_today >= LIMITS.inboxDaily) return { ok: false, reason: 'slow_lane_cap' }
  return { ok: true }
}

export function scheduleSend(now = Date.now(), lane: Lane): Date {
  const [minMs, maxMs] = LIMITS.sendIntervalMs
  const jitter = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs
  const laneFactor = lane === 'slow' ? 2.5 : lane === 'low_risk' ? 1.5 : 1
  return new Date(now + Math.floor(jitter * laneFactor))
}

