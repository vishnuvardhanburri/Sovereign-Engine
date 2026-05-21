import type { DbExecutor, Lane, SendIdentitySelection } from '@sovereign/types'
// Import default to stay compatible across tsx/ESM boundaries.
import LIMITS from '../../../configs/limits/default'

export interface SendingDeps {
  db: DbExecutor
}

function envFlag(name: string, fallback = false): boolean {
  const value = process.env[name]
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function envInteger(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name])
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(Math.trunc(parsed), max))
}

export async function rotateInbox(deps: SendingDeps, clientId: number, lane: Lane): Promise<SendIdentitySelection | null> {
  // Adapter-mode implementation: reuse the exact SQL selection policy we already used in api-gateway/lib/delivery/load-balancer.ts,
  // but keep this service independent of apps/*.
  const computedHealthSql = `GREATEST(0, LEAST(100, ROUND(100 - ((COALESCE(d.bounce_count, 0)::numeric / GREATEST(COALESCE(d.sent_count, 0) + 25, 1)) * 100 * 8))))`
  const rawBounceSql = `CASE WHEN COALESCE(d.sent_count, 0) > 0 THEN (COALESCE(d.bounce_count, 0)::numeric / NULLIF(d.sent_count, 0)) * 100 ELSE 0 END`
  const hasValidationProvider = Boolean(process.env.ZEROBOUNCE_API_KEY || process.env.HUNTER_API_KEY)
  const recoveryCapMax = hasValidationProvider ? 100 : 3
  const recoveryCap = envInteger(
    'DOMAIN_RECOVERY_DAILY_CAP',
    envInteger(
      'DAILY_OUTBOUND_RECOVERY_TRICKLE_LIMIT',
      hasValidationProvider ? 50 : 1,
      0,
      recoveryCapMax
    ),
    0,
    recoveryCapMax
  )
  const recoveryEnabled =
    lane === 'normal' &&
    recoveryCap > 0 &&
    envFlag(
      'SENDING_ENGINE_RECOVERY_SENDER_ENABLED',
      envFlag('DAILY_OUTBOUND_RECOVERY_MODE', Boolean(process.env.ZEROBOUNCE_API_KEY))
    )
  const recoveryMinHealth = envInteger('DOMAIN_RECOVERY_MIN_HEALTH', 30, 0, 100)
  const recoveryMaxBounceRate = envInteger('DOMAIN_RECOVERY_MAX_BOUNCE_RATE', 35, 0, 100)
  const recoveryBounceException = recoveryEnabled
    ? ` OR (
             /* reputation recovery trickle: only tiny capped domains may send verified contacts */
             COALESCE(d.daily_cap, d.daily_limit) BETWEEN 1 AND ${recoveryCap}
             AND ${computedHealthSql} >= ${recoveryMinHealth}
             AND ${rawBounceSql} <= ${recoveryMaxBounceRate}
           )`
    : ''
  const provenBounceBlock = `(NOT (((COALESCE(d.sent_count, 0) >= 20) OR (COALESCE(d.bounce_count, 0) >= 3)) AND ${rawBounceSql} > 5)${recoveryBounceException})`
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

  const isBrevoBlockedDomain = (senderEmail: string): boolean => {
    const email = String(senderEmail ?? '').trim().toLowerCase()
    const domain = email.split('@')[1] ?? ''
    if (!domain) return false
    const raw = process.env.BREVO_BLOCKED_SENDER_DOMAINS ?? 'vishnuvardhanburri.in'
    return raw
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean)
      .some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`))
  }

  const isIdentitySelectionBlocked = (email: string): boolean => {
    if (isBrevoBlockedDomain(email)) {
      const explicit = String(process.env.EMAIL_PROVIDER || process.env.SEND_PROVIDER || '').trim().toLowerCase()
      const isForceBrevo = explicit === 'brevo' || explicit.startsWith('xsmtpsib-') || explicit.includes('brevo_api_key=')
      const smtpHost = String(process.env.SMTP_HOST || '').trim().toLowerCase()
      const isSmtpHostBrevo = smtpHost.includes('brevo') || smtpHost.includes('sendinblue')
      
      const clean = String(email ?? '').trim().toLowerCase()
      const suffixes = [
        clean.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
        (clean.split('@')[1] ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
      ].filter(Boolean)
      
      let hasResend = Boolean(process.env.RESEND_API_KEY)
      for (const prefix of ['RESEND_API_KEY', 'RESEND_KEY']) {
        for (const suffix of suffixes) {
          if (process.env[`${prefix}_${suffix}`]) {
            hasResend = true
          }
        }
      }

      if (isForceBrevo) return true
      if (isSmtpHostBrevo && !hasResend) return true
    }
    return false
  }

  const filteredRows = rows.filter((row) => !isIdentitySelectionBlocked(row.identity.email))
  if (!filteredRows.length) return null

  // rotate top 5
  const top = filteredRows.slice(0, Math.min(5, filteredRows.length))
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
