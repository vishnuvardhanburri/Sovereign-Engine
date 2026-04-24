import 'dotenv/config'
import { Worker as BullWorker } from 'bullmq'
import IORedis from 'ioredis'
import { Pool } from 'pg'
import crypto from 'crypto'
import { decide } from '@xavira/decision-engine'
import { rotateInbox, enforceCaps } from '@xavira/sending-engine'
import { ingestEvent } from '@xavira/tracking-engine'
import { updateDomainStats, getDomainScore } from '@xavira/reputation-engine'
import { sendSmtp } from '@xavira/smtp-client'
import { computeAdaptiveThroughput, loadDomainSignals } from '@xavira/adaptive-controller'
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
  idempotencyKey?: string
}

const SEND_QUEUE = process.env.SEND_QUEUE ?? 'xv-send-queue'

function reqEnv(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

const pool = new Pool({ connectionString: reqEnv('DATABASE_URL') })
const redis = new IORedis(reqEnv('REDIS_URL'))
const REGION = process.env.XV_REGION ?? 'local'
const GLOBAL_SENDS_PER_MINUTE = Number(process.env.GLOBAL_SENDS_PER_MINUTE ?? 120)

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

async function recordMetric(clientId: number, name: string, value: number, metadata?: Record<string, unknown>) {
  try {
    await db(`INSERT INTO system_metrics (client_id, metric_name, metric_value, metadata) VALUES ($1,$2,$3,$4::jsonb)`, [
      clientId,
      name,
      value,
      JSON.stringify(metadata ?? {}),
    ])
  } catch (err) {
    console.warn('[sender-worker] metric insert failed', { name, err: (err as any)?.message ?? String(err) })
  }
}

async function resolveIdempotencyKey(job: SendJob, bullJobId: string | number | undefined): Promise<string> {
  if (job.idempotencyKey) return job.idempotencyKey

  if (job.queueJobId) {
    const res = await db<{ idempotency_key: string | null }>(
      `SELECT idempotency_key
       FROM queue_jobs
       WHERE client_id = $1 AND id = $2
       LIMIT 1`,
      [job.clientId, job.queueJobId]
    )
    const k = res.rows[0]?.idempotency_key
    if (k) return k
  }

  // Fallback: stable per BullMQ job id (prevents duplicates from retries/crashes).
  const fallbackPayload = `${job.clientId}|${String(job.toEmail || '').trim().toLowerCase()}|${job.campaignId ?? 0}|${String(bullJobId ?? '')}`
  return crypto.createHash('sha256').update(fallbackPayload).digest('hex').slice(0, 40)
}

async function runSend(job: SendJob, bullJobId: string | number | undefined) {
  const idemKey = await resolveIdempotencyKey(job, bullJobId)
  const doneKey = `xv:${REGION}:send:done:${job.clientId}:${idemKey}`
  const inflightKey = `xv:${REGION}:send:inflight:${job.clientId}:${idemKey}`
  const failedKey = `xv:${REGION}:send:failed:${job.clientId}:${idemKey}`

  // Back-compat: if older keys exist (pre-region), respect them so we don't re-send.
  const legacyDoneKey = `xv:send:done:${job.clientId}:${idemKey}`

  const alreadyDone = (await redis.get(doneKey)) ?? (await redis.get(legacyDoneKey))
  if (alreadyDone) {
    console.warn('[sender-worker] duplicate suppressed (already done)', { bullJobId, queueJobId: job.queueJobId, idemKey })
    await recordMetric(job.clientId, 'idempotency_hits', 1, { scope: 'worker', state: 'done' })
    await recordMetric(job.clientId, 'duplicate_send_prevented', 1, { scope: 'worker', reason: 'done' })
    return
  }

  const recentlyFailed = await redis.get(failedKey)
  if (recentlyFailed) {
    await recordMetric(job.clientId, 'retry_count', 1, { scope: 'worker', reason: 'recent_failure' })
    throw new Error('retry_later:recent_failure')
  }

  // In-flight lock to prevent concurrent duplicate sends.
  const inflightOk = await redis.set(inflightKey, String(bullJobId ?? 'job'), { NX: true, EX: 10 * 60 })
  if (!inflightOk) {
    console.warn('[sender-worker] duplicate suppressed (inflight)', { bullJobId, queueJobId: job.queueJobId, idemKey })
    await recordMetric(job.clientId, 'inflight_conflicts', 1, { scope: 'worker' })
    await recordMetric(job.clientId, 'duplicate_send_prevented', 1, { scope: 'worker', reason: 'inflight' })
    // Let BullMQ retry later; inflight TTL ensures crash recovery.
    throw new Error('retry_later:inflight_lock')
  }

  try {
    // Global cap safety: queue instead of sending if we exceed global throughput.
    // This protects domains during load spikes.
    const globalKey = `xv:${REGION}:cap:global_send:${new Date().toISOString().slice(0, 16)}` // minute bucket
    const globalCount = await redis.incr(globalKey)
    if (globalCount === 1) {
      await redis.expire(globalKey, 60)
    }
    if (globalCount > GLOBAL_SENDS_PER_MINUTE) {
      await recordMetric(job.clientId, 'defer_rate', 1, { scope: 'worker', reason: 'global_cap' })
      throw new Error('retry_later:global_cap')
    }

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

    // Adaptive sending control (per-domain, no global blast).
    // Replaces static daily ceilings with a feedback-driven throughput function.
    const domainSignals = await loadDomainSignals(db, job.clientId, selection.domain.id)
    const adaptive = computeAdaptiveThroughput(domainSignals, undefined)

    if (adaptive.shouldPauseDomain) {
      await recordMetric(job.clientId, 'domain_pause_triggered', 1, { domainId: selection.domain.id })
      // Best-effort pause in DB so UI reflects safety state.
      await db(
        `UPDATE domains
         SET status = 'paused', updated_at = CURRENT_TIMESTAMP
         WHERE client_id = $1 AND id = $2`,
        [job.clientId, selection.domain.id]
      )
      throw new Error('retry_later:domain_paused_adaptive')
    }

    // Per-domain per-minute limiter.
    const minuteBucket = new Date().toISOString().slice(0, 16)
    const domainRateKey = `xv:${REGION}:adaptive:domain_rate:${job.clientId}:${selection.domain.id}:${minuteBucket}`
    const count = await redis.incr(domainRateKey)
    if (count === 1) await redis.expire(domainRateKey, 70)
    if (count > adaptive.maxPerMinute) {
      await recordMetric(job.clientId, 'adaptive_throttled', 1, {
        domainId: selection.domain.id,
        maxPerMinute: adaptive.maxPerMinute,
        targetPerDay: adaptive.targetPerDay,
        reasons: adaptive.reasons,
      })
      throw new Error('retry_later:adaptive_throttle')
    }

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

    const normalizedTo = String(job.toEmail || '').trim().toLowerCase()

    // Duplicate anomaly fallback: if we somehow already sent to the same email recently,
    // suppress sending to protect domains. This should be extremely rare due to idempotency.
    const dupRes = await db<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM events
       WHERE client_id = $1
         AND event_type = 'sent'
         AND COALESCE(metadata->>'to_email','') = $2
         AND created_at > (CURRENT_TIMESTAMP - INTERVAL '1 hour')`,
      [job.clientId, normalizedTo]
    )
    if (Number(dupRes.rows[0]?.count ?? 0) > 0) {
      await recordMetric(job.clientId, 'duplicate_send_prevented', 1, { scope: 'worker', reason: 'recent_window' })
      console.warn('[sender-worker] duplicate anomaly suppressed (recent window)', { bullJobId, idemKey, to: normalizedTo })
      await redis.set(doneKey, '1', { EX: 60 * 60 * 24 * 7 })
      await redis.set(legacyDoneKey, '1', { EX: 60 * 60 * 24 * 7 })
      await redis.del(inflightKey)
      await redis.del(failedKey)
      await handleTracking({
        type: 'FAILED',
        clientId: job.clientId,
        campaignId: job.campaignId ?? null,
        contactId: job.contactId ?? null,
        queueJobId: job.queueJobId ?? null,
        metadata: { event_code: 'EMAIL_FAILED', reason: 'duplicate_recent_window', to_email: normalizedTo, idempotency_key: idemKey },
      })
      return
    }

    await handleTracking({
      type: 'SENT',
      clientId: job.clientId,
      campaignId: job.campaignId ?? null,
      contactId: job.contactId ?? null,
      identityId: selection.identity.id,
      domainId: selection.domain.id,
      queueJobId: job.queueJobId ?? null,
      providerMessageId: messageId,
      metadata: { event_code: 'EMAIL_SENT', to_email: normalizedTo, idempotency_key: idemKey },
    })

    // Mark idempotency as completed after we successfully sent and tracked.
    await redis.set(doneKey, '1', { EX: 60 * 60 * 24 * 7 })
    await redis.set(legacyDoneKey, '1', { EX: 60 * 60 * 24 * 7 })
    await redis.del(inflightKey)
    await redis.del(failedKey)
    await recordMetric(job.clientId, 'send_success_rate', 1, { scope: 'worker' })
    await recordMetric(job.clientId, 'duplicate_send_prevented', 0, { scope: 'worker' })
  } catch (err) {
    // Failure state: allow retry with backoff; do not deadlock.
    await redis.set(failedKey, String((err as any)?.message ?? 'failed'), { EX: 5 * 60 })
    await redis.del(inflightKey)
    await recordMetric(job.clientId, 'retry_count', 1, { scope: 'worker', reason: (err as any)?.message ?? String(err) })
    throw err
  }
}

async function main() {
  console.log('[sender-worker] starting', { queue: SEND_QUEUE })

  const w = new BullWorker<SendJob>(
    SEND_QUEUE,
    async (job) => {
      await runSend(job.data, job.id)
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
