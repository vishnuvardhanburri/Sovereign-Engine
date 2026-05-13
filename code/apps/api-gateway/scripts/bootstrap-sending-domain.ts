import 'dotenv/config'
import { closePool, query } from '@/lib/db'

function enabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

function cleanEmail(value: unknown): string {
  const email = String(value || '').trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
}

function domainFromEmail(email: string): string {
  const domain = email.split('@')[1] || ''
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) ? domain.toLowerCase() : ''
}

function parseSmtpAccounts(): string[] {
  const raw = String(process.env.SMTP_ACCOUNTS || '').trim()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => cleanEmail(item?.user)).filter(Boolean)
  } catch {
    return []
  }
}

function resolveBootstrapEmails(): string[] {
  const explicit = String(process.env.BOOTSTRAP_SENDING_EMAILS || '')
    .split(/[\s,;]+/)
    .map(cleanEmail)
    .filter(Boolean)

  const candidates = [
    ...explicit,
    ...parseSmtpAccounts(),
    cleanEmail(process.env.SMTP_FROM_EMAIL),
    cleanEmail(process.env.SMTP_USER),
  ].filter(Boolean)

  return [...new Set(candidates)]
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(process.env[name] || ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

async function main(): Promise<void> {
  if (!enabled(process.env.BOOTSTRAP_SENDING_DOMAIN)) {
    console.log('[bootstrap-sending-domain] disabled')
    return
  }

  const emails = resolveBootstrapEmails()
  if (!emails.length) {
    throw new Error('BOOTSTRAP_SENDING_EMAILS, SMTP_ACCOUNTS, SMTP_FROM_EMAIL, or SMTP_USER must include a valid email')
  }

  const clientId = intEnv('DEFAULT_CLIENT_ID', 1, 1, 1_000_000)
  const domainDailyLimit = intEnv('BOOTSTRAP_DOMAIN_DAILY_LIMIT', 50, 1, 500)
  const identityDailyLimit = intEnv('BOOTSTRAP_IDENTITY_DAILY_LIMIT', 25, 1, 200)
  const markAuthValid = enabled(process.env.BOOTSTRAP_MARK_DNS_VALID)
  const bootstrapped: Array<{ domain: string; email: string }> = []

  for (const email of emails) {
    const domain = String(process.env.BOOTSTRAP_DOMAIN || domainFromEmail(email)).trim().toLowerCase()
    if (!domain) throw new Error(`Unable to resolve sending domain for ${email}`)

    const domainRes = await query<{ id: string | number }>(
      `INSERT INTO domains (
         client_id,
         domain,
         status,
         paused,
         warmup_stage,
         spf_valid,
         dkim_valid,
         dmarc_valid,
         daily_limit,
         daily_cap,
         health_score,
         reputation_score
       )
       VALUES ($1, $2, 'active', FALSE, 1, $3, $3, $3, $4, $4, 100, 100)
       ON CONFLICT (client_id, domain) DO UPDATE
       SET status = 'active',
           paused = FALSE,
           daily_limit = LEAST(domains.daily_limit, EXCLUDED.daily_limit),
           daily_cap = COALESCE(domains.daily_cap, EXCLUDED.daily_cap),
           updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [clientId, domain, markAuthValid, domainDailyLimit]
    )
    const domainId = domainRes.rows[0]?.id
    if (!domainId) throw new Error(`Failed to bootstrap domain ${domain}`)

    await query(
      `INSERT INTO identities (client_id, domain_id, email, daily_limit, status)
       VALUES ($1, $2, $3, $4, 'active')
       ON CONFLICT (client_id, email) DO UPDATE
       SET domain_id = EXCLUDED.domain_id,
           status = 'active',
           daily_limit = LEAST(identities.daily_limit, EXCLUDED.daily_limit),
           updated_at = CURRENT_TIMESTAMP`,
      [clientId, domainId, email, identityDailyLimit]
    )

    bootstrapped.push({ domain, email })
  }

  console.log('[bootstrap-sending-domain] ready', { clientId, bootstrapped, domainDailyLimit, identityDailyLimit })
}

main()
  .catch((error) => {
    console.error('[bootstrap-sending-domain] failed', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await closePool()
  })
