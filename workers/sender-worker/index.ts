import 'dotenv/config'
import { Worker as BullWorker } from 'bullmq'
import IORedis from 'ioredis'
import { Pool } from 'pg'
import { decide } from '@xavira/decision-engine'
import { rotateInbox, enforceCaps } from '@xavira/sending-engine'
import { ingestEvent } from '@xavira/tracking-engine'
import { updateDomainStats, getDomainScore } from '@xavira/reputation-engine'
import { sendSmtp } from '@xavira/smtp-client'
import type { DbExecutor, TrackingIngestEvent, ValidationVerdict, Lane } from '@xavira/types'

type SendJob = {
  clientId: number
  campaignId?: number
  contactId?: number
  queueJobId?: number
  toEmail: string
  subject: string
  html?: string
  text?: string
}

const SEND_QUEUE = process.env.SEND_QUEUE ?? 'xv-send-queue'

function reqEnv(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

const pool = new Pool({ connectionString: reqEnv('DATABASE_URL') })
const redis = new IORedis(reqEnv('REDIS_URL'))

const db: DbExecutor = async (sql, params = []) => {
  const res = await pool.query(sql, params as any[])
  return { rows: res.rows as any[], rowCount: res.rowCount ?? 0 }
}

async function lookupValidation(email: string): Promise<{ verdict: ValidationVerdict; score: number; catchAll?: boolean }> {
  const normalized = String(email || '').trim().toLowerCase()
  const res = await db<{ verdict: ValidationVerdict; score: string | number; catch_all: any }>(
    `SELECT verdict, score, catch_all
     FROM email_validations
     WHERE normalized_email = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [normalized]
  )
  const row = res.rows[0]
  if (!row) return { verdict: 'unknown', score: 0.5 }
  const catchAll = Boolean((row as any).catch_all?.isCatchAll ?? (row as any).catch_all?.catchAll)
  return { verdict: row.verdict, score: Number(row.score ?? 0), catchAll }
}

async function handleTracking(event: TrackingIngestEvent) {
  await ingestEvent({ db }, event)
  await updateDomainStats({ db }, event)
}

async function runSend(job: SendJob) {
  const validation = await lookupValidation(job.toEmail)

  // Best-effort: domain score is used to route valid traffic if domain is unhealthy.
  const domainIdRes = await db<{ id: number }>(
    `SELECT id
     FROM domains
     WHERE client_id = $1 AND domain = split_part($2,'@',2)
     LIMIT 1`,
    [job.clientId, job.toEmail]
  )
  const domainId = domainIdRes.rows[0]?.id
  const domainScore = domainId ? (await getDomainScore({ db }, job.clientId, domainId))?.score : undefined

  const decision = decide({
    email: job.toEmail,
    verdict: validation.verdict,
    score: validation.score,
    domainScore,
    catchAll: validation.catchAll,
  })

  if (decision.action === 'drop') {
    await handleTracking({
      type: 'FAILED',
      clientId: job.clientId,
      campaignId: job.campaignId ?? null,
      contactId: job.contactId ?? null,
      queueJobId: job.queueJobId ?? null,
      metadata: { reason: decision.reason, event_code: 'EMAIL_FAILED' },
    })
    return
  }

  if (decision.action === 'retry_later') {
    throw new Error(`retry_later:${decision.reason}`)
  }

  const lane: Lane = decision.lane
  const selection = await rotateInbox({ db }, job.clientId, lane)
  if (!selection) throw new Error('no_sender_identity_available')

  const caps = enforceCaps(selection, lane)
  if (!caps.ok) throw new Error(`caps:${caps.reason}`)

  const smtpHost = reqEnv('SMTP_HOST')
  const smtpUser = reqEnv('SMTP_USER')
  const smtpPass = reqEnv('SMTP_PASS')

  const { messageId } = await sendSmtp(
    { host: smtpHost, user: smtpUser, pass: smtpPass },
    {
      from: selection.identity.email,
      to: job.toEmail,
      subject: job.subject,
      html: job.html,
      text: job.text,
      headers: { 'X-Xavira-Lane': lane },
    }
  )

  await db(
    `UPDATE identities
     SET sent_today = sent_today + 1,
         sent_count = sent_count + 1,
         last_sent_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE client_id = $1 AND id = $2`,
    [job.clientId, selection.identity.id]
  )
  await db(
    `UPDATE domains
     SET sent_today = sent_today + 1,
         sent_count = sent_count + 1,
         updated_at = CURRENT_TIMESTAMP
     WHERE client_id = $1 AND id = $2`,
    [job.clientId, selection.domain.id]
  )

  await handleTracking({
    type: 'SENT',
    clientId: job.clientId,
    campaignId: job.campaignId ?? null,
    contactId: job.contactId ?? null,
    identityId: selection.identity.id,
    domainId: selection.domain.id,
    queueJobId: job.queueJobId ?? null,
    providerMessageId: messageId,
    metadata: { event_code: 'EMAIL_SENT' },
  })
}

async function main() {
  console.log('[sender-worker] starting', { queue: SEND_QUEUE })

  const w = new BullWorker<SendJob>(
    SEND_QUEUE,
    async (job) => {
      await runSend(job.data)
    },
    {
      connection: { url: reqEnv('REDIS_URL') },
      concurrency: 10,
      lockDuration: 30_000,
    }
  )

  w.on('failed', (job, err) => {
    console.error('[sender-worker] job failed', { id: job?.id, err: err?.message })
  })

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

async function shutdown(signal: string) {
  console.log('[sender-worker] shutting down', { signal })
  await Promise.allSettled([redis.quit(), pool.end()])
  process.exit(0)
}

main().catch((err) => {
  console.error('[sender-worker] fatal', err)
  process.exit(1)
})

