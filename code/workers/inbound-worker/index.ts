import 'dotenv/config'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import IORedis from 'ioredis'
import { Pool } from 'pg'
import { ingestEvent } from '@sovereign/tracking-engine'
import type { DbExecutor } from '@sovereign/types'

type ImapAccount = { user: string; pass: string }

function reqEnv(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

function readJsonArray(name: string): any[] {
  const raw = process.env[name]
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function normalizeEmail(v: string) {
  return String(v || '').trim().toLowerCase()
}

function normalizeMsgId(v: string) {
  const s = String(v || '').trim()
  if (!s) return ''
  // message-id headers usually contain <...>
  return s.replace(/^<|>$/g, '')
}

function normalizeSubject(v: string) {
  const s = String(v || '').trim()
  return s.replace(/^(re|fw|fwd)\s*:\s*/gi, '').trim().toLowerCase()
}

const pool = new Pool({ connectionString: reqEnv('DATABASE_URL') })
const redis = new IORedis(reqEnv('REDIS_URL'))

const IMAP_HOST = reqEnv('IMAP_HOST')
const IMAP_PORT = Number(process.env.IMAP_PORT ?? 993)
const IMAP_SECURE = process.env.IMAP_SECURE !== 'false'
const IMAP_POLL_INTERVAL = Number(process.env.IMAP_POLL_INTERVAL ?? 30_000)

const IMAP_ACCOUNTS: ImapAccount[] = readJsonArray('IMAP_ACCOUNTS')
  .map((x) => ({ user: String(x?.user ?? ''), pass: String(x?.pass ?? '') }))
  .filter((x) => x.user && x.pass)

const SMTP_ACCOUNTS: ImapAccount[] = readJsonArray('SMTP_ACCOUNTS')
  .map((x) => ({ user: String(x?.user ?? ''), pass: String(x?.pass ?? '') }))
  .filter((x) => x.user && x.pass)

const OUR_ADDRESSES = new Set(
  [...IMAP_ACCOUNTS.map((a) => a.user), ...SMTP_ACCOUNTS.map((a) => a.user), process.env.SMTP_USER, process.env.IMAP_USER]
    .filter(Boolean)
    .map((x) => normalizeEmail(String(x)))
)

const db: DbExecutor = async (sql, params = []) => {
  const client = await pool.connect()
  try {
    const res = await client.query(sql as any, params as any)
    return { rows: res.rows as any, rowCount: res.rowCount }
  } finally {
    client.release()
  }
}

async function claimInboundMessage(messageId: string) {
  const key = `xv:inbound:processed:${messageId}`
  // Atomic: set only if not already processed.
  const ok = await redis.set(key, '1', 'EX', 60 * 60 * 24 * 7, 'NX')
  return ok === 'OK'
}

type MatchContext = {
  clientId: number
  campaignId: number | null
  queueJobId: number | null
  contactId: number | null
  identityId: number | null
  domainId: number | null
}

async function matchReplyToContext(input: {
  inReplyTo?: string
  references?: string[]
  subject?: string
  fromEmail: string
  toEmail: string
}): Promise<MatchContext | null> {
  const inReplyTo = normalizeMsgId(input.inReplyTo ?? '')
  const refs = (input.references ?? []).map(normalizeMsgId).filter(Boolean)

  const msgIds = [inReplyTo, ...refs].filter(Boolean)
  for (const mid of msgIds) {
    // Try both raw and <...> forms because different systems store differently.
    const raw = `<${mid}>`
    const res = await db<MatchContext>(
      `SELECT client_id AS "clientId",
              campaign_id AS "campaignId",
              queue_job_id AS "queueJobId",
              contact_id AS "contactId",
              identity_id AS "identityId",
              domain_id AS "domainId"
       FROM events
       WHERE event_type = 'sent'
         AND (provider_message_id = $1 OR provider_message_id = $2 OR provider_message_id = $3)
       ORDER BY created_at DESC
       LIMIT 1`,
      [mid, raw, input.inReplyTo ?? null]
    )
    if (res.rows[0]) return res.rows[0]
  }

  const subj = normalizeSubject(input.subject ?? '')
  if (subj) {
    const res = await db<MatchContext>(
      `SELECT client_id AS "clientId",
              campaign_id AS "campaignId",
              queue_job_id AS "queueJobId",
              contact_id AS "contactId",
              identity_id AS "identityId",
              domain_id AS "domainId"
       FROM events
       WHERE event_type = 'sent'
         AND COALESCE(metadata->>'subject','') <> ''
         AND LOWER(REGEXP_REPLACE(COALESCE(metadata->>'subject',''), '^(re|fw|fwd)\\s*:\\s*', '', 'gi')) = $1
         AND created_at > (CURRENT_TIMESTAMP - INTERVAL '30 days')
       ORDER BY created_at DESC
       LIMIT 1`,
      [subj]
    )
    if (res.rows[0]) return res.rows[0]
  }

  const fromEmail = normalizeEmail(input.fromEmail)
  if (fromEmail) {
    // Fallback: match by recipient email of our sent logs (i.e. their address).
    const res = await db<MatchContext>(
      `SELECT client_id AS "clientId",
              campaign_id AS "campaignId",
              queue_job_id AS "queueJobId",
              contact_id AS "contactId",
              identity_id AS "identityId",
              domain_id AS "domainId"
       FROM events
       WHERE event_type = 'sent'
         AND COALESCE(metadata->>'to_email','') = $1
         AND created_at > (CURRENT_TIMESTAMP - INTERVAL '14 days')
       ORDER BY created_at DESC
       LIMIT 1`,
      [fromEmail]
    )
    if (res.rows[0]) return res.rows[0]
  }

  return null
}

async function processAccount(account: ImapAccount) {
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: IMAP_SECURE,
    auth: { user: account.user, pass: account.pass },
    logger: false,
  })

  await client.connect()
  try {
    await client.mailboxOpen('INBOX')

    const unseen = await client.search({ seen: false })
    if (!unseen.length) return

    // Process oldest-first so we keep threading consistent.
    unseen.sort((a, b) => a - b)

    for (const uid of unseen) {
      const msg = await client.fetchOne(uid, { source: true, envelope: true, uid: true, flags: true })
      if (!msg?.source) continue

      const parsed = await simpleParser(msg.source)
      const messageId = normalizeMsgId(String(parsed.messageId ?? ''))
      if (!messageId) {
        // Still mark seen so we don't loop forever on malformed mail.
        await client.messageFlagsAdd(uid, ['\\Seen']).catch(() => {})
        continue
      }

      const claimed = await claimInboundMessage(messageId)
      if (!claimed) {
        await client.messageFlagsAdd(uid, ['\\Seen']).catch(() => {})
        continue
      }

      const fromEmail = normalizeEmail(parsed.from?.value?.[0]?.address ?? '')
      const toEmail = normalizeEmail(parsed.to?.value?.[0]?.address ?? account.user)

      // Skip our own outbound messages / system emails.
      if (OUR_ADDRESSES.has(fromEmail)) {
        await client.messageFlagsAdd(uid, ['\\Seen']).catch(() => {})
        continue
      }

      const subject = String(parsed.subject ?? '').trim()
      const body = String(parsed.text ?? parsed.html ?? '').trim()

      const inReplyTo = normalizeMsgId(String((parsed.headers as any)?.get?.('in-reply-to') ?? parsed.inReplyTo ?? ''))
      const referencesRaw = String((parsed.headers as any)?.get?.('references') ?? '')
      const references = referencesRaw
        ? referencesRaw
            .split(/\s+/g)
            .map((x) => x.trim())
            .filter(Boolean)
        : []

      const ctx = await matchReplyToContext({
        inReplyTo,
        references,
        subject,
        fromEmail,
        toEmail,
      })

      const clientId = ctx?.clientId ?? 1

      await ingestEvent(
        { db },
        {
          type: 'REPLIED',
          clientId,
          campaignId: ctx?.campaignId ?? null,
          contactId: ctx?.contactId ?? null,
          identityId: ctx?.identityId ?? null,
          domainId: ctx?.domainId ?? null,
          queueJobId: ctx?.queueJobId ?? null,
          providerMessageId: messageId,
          metadata: {
            event_code: 'EMAIL_REPLIED',
            source: 'imap',
            message_id: messageId,
            in_reply_to: inReplyTo || undefined,
            references: references.length ? references : undefined,
            from_email: fromEmail,
            to_email: toEmail,
            subject,
            body,
          },
        }
      )

      await client.messageFlagsAdd(uid, ['\\Seen']).catch(() => {})
    }
  } finally {
    await client.logout().catch(() => {})
  }
}

async function tick() {
  for (const acct of IMAP_ACCOUNTS) {
    try {
      await processAccount(acct)
    } catch (err) {
      console.error('[inbound-worker] IMAP poll failed', { user: acct.user, error: (err as any)?.message ?? String(err) })
    }
  }
}

async function main() {
  if (!IMAP_ACCOUNTS.length) {
    throw new Error('IMAP_ACCOUNTS is empty. Provide JSON array of {user,pass}.')
  }

  console.log('[inbound-worker] starting', {
    host: IMAP_HOST,
    pollIntervalMs: IMAP_POLL_INTERVAL,
    accounts: IMAP_ACCOUNTS.map((a) => a.user),
  })

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await tick()
    await new Promise((r) => setTimeout(r, IMAP_POLL_INTERVAL))
  }
}

main().catch((err) => {
  console.error('[inbound-worker] fatal', err)
  process.exit(1)
})
