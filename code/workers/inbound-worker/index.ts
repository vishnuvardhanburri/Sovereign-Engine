import 'dotenv/config'
import { ImapFlow } from 'imapflow'
// mailparser does not ship TS declarations in this workspace, but tsx runtime loads it correctly.
// @ts-ignore
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

function truncateForMetadata(value: string, max = 2_000) {
  return value.length > max ? `${value.slice(0, max)}...` : value
}

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const DSN_SUBJECT_REGEX =
  /(delivery status notification|undelivered mail returned|mail delivery failed|failure notice|returned mail|delivery failure)/i
const DSN_BODY_REGEX = /(final-recipient|diagnostic-code|this is the mail system|recipient address rejected|no such user)/i
const HARD_BOUNCE_REGEX =
  /\b(5\d\d|5\.\d+\.\d+|no such user|recipient address rejected|access denied|user unknown|mailbox unavailable|does not exist)\b/i
const SYSTEM_BOUNCE_LOCAL_PARTS = new Set(['mailer-daemon', 'postmaster', 'mail delivery subsystem', 'mail delivery system'])
const SYSTEM_BOUNCE_DOMAINS = new Set([
  'googlemail.com',
  'mailchannels.net',
  'amazonses.com',
  'sendgrid.net',
])

function emailLocalPart(email: string) {
  return normalizeEmail(email).split('@')[0] ?? ''
}

function emailDomainPart(email: string) {
  return normalizeEmail(email).split('@')[1] ?? ''
}

function uniqueEmailsFrom(text: string) {
  return Array.from(new Set((text.match(EMAIL_REGEX) ?? []).map(normalizeEmail).filter(Boolean)))
}

function isSystemBounceSender(email: string) {
  const normalized = normalizeEmail(email)
  const local = emailLocalPart(normalized)
  return SYSTEM_BOUNCE_LOCAL_PARTS.has(local) || local.startsWith('mailer-daemon') || local === 'postmaster'
}

function isBounceInfrastructureEmail(email: string) {
  const domain = emailDomainPart(email)
  return isSystemBounceSender(email) || SYSTEM_BOUNCE_DOMAINS.has(domain)
}

function isDeliverabilityNotice(input: { fromEmail: string; subject: string; body: string }) {
  const fromSystem = isSystemBounceSender(input.fromEmail)
  const fromInfra = isBounceInfrastructureEmail(input.fromEmail)
  const subjectLooksDsn = DSN_SUBJECT_REGEX.test(input.subject)
  const bodyLooksDsn = DSN_BODY_REGEX.test(input.body)

  return (
    fromSystem ||
    (subjectLooksDsn && bodyLooksDsn) ||
    (fromInfra && (subjectLooksDsn || bodyLooksDsn))
  )
}

function classifyDsnReason(body: string) {
  const lower = body.toLowerCase()
  if (/5\.1\.1|no such user|does not exist|user unknown/.test(lower)) return 'no_such_user'
  if (/5\.4\.1|recipient address rejected|access denied/.test(lower)) return 'recipient_rejected'
  if (/mailbox unavailable|disabled mailbox|mailbox not found/.test(lower)) return 'mailbox_unavailable'
  if (HARD_BOUNCE_REGEX.test(body)) return 'hard_bounce'
  return 'delivery_notice'
}

function extractFailedRecipients(body: string) {
  const candidates = new Set<string>()
  const patterns = [
    /(?:Final|Original)-Recipient:\s*rfc822;\s*<?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>?/gi,
    /<([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>:/gi,
    /\bfor\s+<([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>/gi,
  ]

  for (const pattern of patterns) {
    for (const match of body.matchAll(pattern)) {
      if (match[1]) candidates.add(normalizeEmail(match[1]))
    }
  }

  if (!candidates.size) {
    for (const email of uniqueEmailsFrom(body)) candidates.add(email)
  }

  return Array.from(candidates).filter((email) => {
    if (!email || OUR_ADDRESSES.has(email)) return false
    if (isBounceInfrastructureEmail(email)) return false
    const local = emailLocalPart(email)
    if (local === 'mailer-daemon' || local === 'postmaster') return false
    return true
  })
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
    return { rows: res.rows as any, rowCount: res.rowCount ?? 0 }
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

async function matchBounceToContext(failedRecipient: string): Promise<MatchContext | null> {
  const email = normalizeEmail(failedRecipient)
  if (!email) return null

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
       AND created_at > (CURRENT_TIMESTAMP - INTERVAL '30 days')
     ORDER BY created_at DESC
     LIMIT 1`,
    [email]
  )
  return res.rows[0] ?? null
}

async function suppressBouncedRecipient(input: {
  clientId: number
  contactId: number | null
  queueJobId: number | null
  email: string
  reason: string
}) {
  const email = normalizeEmail(input.email)
  if (!email) return

  if (input.contactId) {
    await db(
      `UPDATE contacts
       SET status = 'bounced',
           bounced_at = COALESCE(bounced_at, CURRENT_TIMESTAMP),
           verification_status = 'invalid',
           verification_sub_status = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1 AND id = $2`,
      [input.clientId, input.contactId, input.reason]
    )
  } else {
    await db(
      `UPDATE contacts
       SET status = 'bounced',
           bounced_at = COALESCE(bounced_at, CURRENT_TIMESTAMP),
           verification_status = 'invalid',
           verification_sub_status = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1 AND email = $2`,
      [input.clientId, email, input.reason]
    )
  }

  await db(
    `INSERT INTO suppression_list (client_id, email, reason, source)
     VALUES ($1, $2, 'bounced', 'imap_dsn')
     ON CONFLICT (client_id, email) DO UPDATE
     SET reason = 'bounced',
         source = EXCLUDED.source`,
    [input.clientId, email]
  )

  if (input.queueJobId) {
    await db(
      `UPDATE queue_jobs
       SET status = CASE WHEN status IN ('completed', 'skipped') THEN status ELSE 'failed' END,
           last_error = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1 AND id = $3`,
      [input.clientId, `dsn_bounce:${input.reason}`, input.queueJobId]
    )
  }
}

async function recordDsnBounce(input: {
  messageId: string
  fromEmail: string
  toEmail: string
  subject: string
  body: string
  failedRecipient: string
  reason: string
}) {
  const failedRecipient = normalizeEmail(input.failedRecipient)
  const ctx = await matchBounceToContext(failedRecipient)
  const clientId = ctx?.clientId ?? 1

  await ingestEvent(
    { db },
    {
      type: 'BOUNCED',
      clientId,
      campaignId: ctx?.campaignId ?? null,
      contactId: ctx?.contactId ?? null,
      identityId: ctx?.identityId ?? null,
      domainId: ctx?.domainId ?? null,
      queueJobId: ctx?.queueJobId ?? null,
      providerMessageId: input.messageId,
      metadata: {
        event_code: 'EMAIL_BOUNCED',
        source: 'imap_dsn',
        idempotency_key: `dsn:${input.messageId}:${failedRecipient}`,
        failed_recipient: failedRecipient,
        from_email: input.fromEmail,
        to_email: input.toEmail,
        subject: input.subject,
        dsn_reason: input.reason,
        body: truncateForMetadata(input.body),
      },
    }
  )

  await suppressBouncedRecipient({
    clientId,
    contactId: ctx?.contactId ?? null,
    queueJobId: ctx?.queueJobId ?? null,
    email: failedRecipient,
    reason: input.reason,
  })
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

    const unseenRaw = await client.search({ seen: false })
    const unseen = Array.isArray(unseenRaw) ? unseenRaw : []
    if (!unseen.length) return

    // Process oldest-first so we keep threading consistent.
    unseen.sort((a: number, b: number) => a - b)

    for (const uid of unseen) {
      const msg = await client.fetchOne(uid, { source: true, envelope: true, uid: true, flags: true })
      if (!msg || !('source' in msg) || !msg.source) continue

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

      if (isDeliverabilityNotice({ fromEmail, subject, body })) {
        const reason = classifyDsnReason(body)
        const failedRecipients = extractFailedRecipients(body)

        for (const failedRecipient of failedRecipients) {
          await recordDsnBounce({
            messageId,
            fromEmail,
            toEmail,
            subject,
            body,
            failedRecipient,
            reason,
          })
        }

        console.log('[inbound-worker] delivery notice processed', {
          fromEmail,
          subject,
          reason,
          failedRecipients,
        })

        await client.messageFlagsAdd(uid, ['\\Seen']).catch(() => {})
        continue
      }

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
