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
import { computeAdaptiveThroughput, loadDomainSignals, type AdaptiveState, type ProviderSignals } from '@xavira/adaptive-controller'
import { detectProvider, getProviderPolicy } from '@xavira/provider-engine'
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
const GLOBAL_SHAPER_RATE_PER_SEC = Number(process.env.GLOBAL_SHAPER_RATE_PER_SEC ?? 2) // tokens/sec
const GLOBAL_SHAPER_BURST = Number(process.env.GLOBAL_SHAPER_BURST ?? 10) // max tokens

const GLOBAL_RISK_SLOWDOWN_FACTOR = 0.75
const GLOBAL_RISK_WINDOW_SEC = 60 * 60 // 1h
const GLOBAL_RISK_THRESHOLD = 3 // domains spiking before applying slowdown

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

// Atomic Redis token bucket (anti-burst).
const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local rate = tonumber(ARGV[1])
local burst = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local ttl_sec = tonumber(ARGV[5])

local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
if tokens == nil then tokens = burst end
if ts == nil then ts = now_ms end

local delta = math.max(0, now_ms - ts)
local refill = (delta / 1000.0) * rate
tokens = math.min(burst, tokens + refill)

local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end

redis.call('HSET', key, 'tokens', tokens, 'ts', now_ms)
redis.call('EXPIRE', key, ttl_sec)
return { allowed, tokens }
`

async function takeGlobalToken(clientId: number): Promise<boolean> {
  const key = `xv:${REGION}:shaper:global:${clientId}`
  const now = Date.now()
  const [allowed] = (await redis.eval(
    TOKEN_BUCKET_LUA,
    1,
    key,
    String(GLOBAL_SHAPER_RATE_PER_SEC),
    String(GLOBAL_SHAPER_BURST),
    String(now),
    '1',
    '120'
  )) as any
  return Number(allowed) === 1
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function jitterMs(base: number, pct = 0.15) {
  const j = base * pct
  return Math.max(0, Math.floor(base + (Math.random() * 2 - 1) * j))
}

async function getBestHours(clientId: number, domainId: number): Promise<number[] | null> {
  const cacheKey = `xv:${REGION}:adaptive:best_hours:${clientId}:${domainId}`
  const cached = await redis.get(cacheKey)
  if (cached) {
    try {
      const v = JSON.parse(cached)
      if (Array.isArray(v) && v.every((n) => Number.isFinite(n))) return v as number[]
    } catch {}
  }

  // Compute top hours by reply rate over last 7 days; require some volume for signal.
  const res = await db<{ hour: number; sent: string; reply: string }>(
    `SELECT
       EXTRACT(HOUR FROM created_at)::int AS hour,
       COUNT(*) FILTER (WHERE event_type='sent')::text AS sent,
       COUNT(*) FILTER (WHERE event_type='reply')::text AS reply
     FROM events
     WHERE client_id = $1 AND domain_id = $2
       AND created_at > (CURRENT_TIMESTAMP - INTERVAL '7 days')
       AND event_type IN ('sent','reply')
     GROUP BY 1
     ORDER BY 1`,
    [clientId, domainId]
  )

  const scored = res.rows
    .map((r) => {
      const sent = Number(r.sent ?? 0)
      const reply = Number(r.reply ?? 0)
      const rate = sent >= 20 ? reply / Math.max(sent, 1) : -1
      return { hour: r.hour, rate, sent }
    })
    .filter((x) => x.rate >= 0)
    .sort((a, b) => b.rate - a.rate)

  const best = scored.slice(0, 3).map((x) => x.hour)
  if (!best.length) return null
  await redis.set(cacheKey, JSON.stringify(best), { EX: 6 * 60 * 60 })
  return best
}

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
    // Jitter injection: avoid batchy patterns.
    await sleep(jitterMs(250, 0.8))

    // Global cap safety: queue instead of sending if we exceed global throughput.
    // This protects domains during load spikes.
    const minuteBucket = new Date().toISOString().slice(0, 16) // minute bucket
    const globalKey = `xv:${REGION}:cap:global_send:${minuteBucket}`
    const globalCount = await redis.incr(globalKey)
    if (globalCount === 1) {
      await redis.expire(globalKey, 60)
    }
    if (globalCount > GLOBAL_SENDS_PER_MINUTE) {
      await recordMetric(job.clientId, 'defer_rate', 1, { scope: 'worker', reason: 'global_cap' })
      throw new Error('retry_later:global_cap')
    }

    // Global shaper (anti-burst): token bucket across all domains for this client/org.
    const ok = await takeGlobalToken(job.clientId)
    if (!ok) {
      await recordMetric(job.clientId, 'defer_rate', 1, { scope: 'worker', reason: 'global_shaper' })
      // jittered backoff to smooth retry storms
      throw new Error('retry_later:global_shaper')
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

    // Adaptive sending control (per-domain, provider-safe, abuse-resistant).
    // Multi-signal gating + EMA + cooldown + ramp profiles.
    const recipientProvider = detectProvider(job.toEmail)
    const providerPolicy = getProviderPolicy(recipientProvider)
    const bestHours = await getBestHours(job.clientId, selection.domain.id)
    const nowHour = new Date().getUTCHours()
    const timeWindowOk = bestHours ? bestHours.includes(nowHour) : true
    const providerSignals: ProviderSignals = { provider: recipientProvider, timeWindowHour: nowHour }

    const domainSignals = await loadDomainSignals(db, job.clientId, selection.domain.id)
    const adaptiveStateKey = `xv:${REGION}:adaptive:state:${job.clientId}:${selection.domain.id}`
    const prevStateRaw = await redis.get(adaptiveStateKey)
    const prevState: AdaptiveState | undefined = prevStateRaw ? (JSON.parse(prevStateRaw) as any) : undefined

    const { throughput: adaptive, nextState } = computeAdaptiveThroughput(domainSignals, providerSignals, prevState, Date.now())
    await redis.set(adaptiveStateKey, JSON.stringify(nextState), { EX: 60 * 60 * 24 * 7 })

    if (adaptive.shouldPauseDomain) {
      await recordMetric(job.clientId, 'domain_pause_triggered', 1, { domainId: selection.domain.id })
      await recordMetric(job.clientId, 'auto_pause_count', 1, { domainId: selection.domain.id, reasons: adaptive.reasons })
      // Best-effort pause in DB so UI reflects safety state.
      await db(
        `UPDATE domains
         SET status = 'paused', updated_at = CURRENT_TIMESTAMP
         WHERE client_id = $1 AND id = $2`,
        [job.clientId, selection.domain.id]
      )
      if (adaptive.hardStop) {
        await recordMetric(job.clientId, 'cooldown_events', 1, { domainId: selection.domain.id, kind: 'hard_stop' })
        // Hard-stop: do not retry this job; suppress future attempts.
        await handleTracking({
          type: 'FAILED',
          clientId: job.clientId,
          campaignId: job.campaignId ?? null,
          contactId: job.contactId ?? null,
          queueJobId: job.queueJobId ?? null,
          metadata: {
            event_code: 'EMAIL_FAILED',
            reason: 'domain_hard_stop',
            idempotency_key: idemKey,
            adaptive: {
              throughput_current: adaptive.maxPerMinute,
              reasons: adaptive.reasons,
              next_window_action: adaptive.nextWindowAction,
              provider: recipientProvider,
            },
          },
        })
        await redis.set(doneKey, '1', { EX: 60 * 60 * 24 * 7 })
        await redis.set(legacyDoneKey, '1', { EX: 60 * 60 * 24 * 7 })
        await redis.del(inflightKey)
        await redis.del(failedKey)
        return
      }
      throw new Error('retry_later:domain_paused_adaptive')
    }

    // Time-of-day bias: reduce throughput outside best windows (soft).
    let effectiveMaxPerMinute = adaptive.maxPerMinute
    if (!timeWindowOk) {
      effectiveMaxPerMinute = Math.max(2, Math.floor(effectiveMaxPerMinute * 0.8))
    }

    // Cross-domain safe coupling: if multiple domains show throttling signals, slow the whole org slightly.
    const riskBucket = `xv:${REGION}:adaptive:risk_bucket:${job.clientId}:${minuteBucket}`
    const hasRiskSignal =
      adaptive.reasons.includes('block_rate_detected_cooldown') ||
      adaptive.reasons.includes('deferral_rate_spike_halve')
    if (hasRiskSignal) {
      const n = await redis.incr(riskBucket)
      if (n === 1) await redis.expire(riskBucket, 10 * 60)
      if (n >= GLOBAL_RISK_THRESHOLD) {
        await redis.set(`xv:${REGION}:adaptive:global_risk:${job.clientId}`, '1', { EX: GLOBAL_RISK_WINDOW_SEC })
        await recordMetric(job.clientId, 'cooldown_events', 1, { scope: 'global', reason: 'multi_domain_risk' })
      }
    }
    const globalRisk = await redis.get(`xv:${REGION}:adaptive:global_risk:${job.clientId}`)
    if (globalRisk) {
      effectiveMaxPerMinute = Math.max(2, Math.floor(effectiveMaxPerMinute * GLOBAL_RISK_SLOWDOWN_FACTOR))
    }

    // Recipient-provider memory throttling: if provider is degraded, slow just that provider.
    const providerKey = `xv:${REGION}:adaptive:provider_risk:${job.clientId}:${recipientProvider}`
    const providerRisk = Number((await redis.get(providerKey)) ?? 0)
    if (providerRisk > 0) {
      effectiveMaxPerMinute = Math.max(2, Math.floor(effectiveMaxPerMinute * (1 - clamp(providerRisk, 0.1, 0.5))))
    }

    // Per-domain per-minute limiter.
    // NOTE: minuteBucket already defined above for global cap; keep it consistent for shaping.
    const domainRateKey = `xv:${REGION}:adaptive:domain_rate:${job.clientId}:${selection.domain.id}:${minuteBucket}`
    const count = await redis.incr(domainRateKey)
    if (count === 1) await redis.expire(domainRateKey, 70)
    if (count > effectiveMaxPerMinute) {
      await recordMetric(job.clientId, 'adaptive_throttled', 1, {
        domainId: selection.domain.id,
        maxPerMinute: effectiveMaxPerMinute,
        targetPerDay: adaptive.targetPerDay,
        reasons: adaptive.reasons,
        nextWindowAction: adaptive.nextWindowAction,
      })
      // Graceful drain: jittered retry so we don't synchronize.
      throw new Error('retry_later:adaptive_throttle')
    }

    // Max concurrent SMTP connections per domain (hard safety floor).
    // Provider-aware concurrency ceiling (recipient provider).
    const maxConcurrency = Math.max(1, Math.min(3, providerPolicy.maxDomainConcurrency))
    const concKey = `xv:${REGION}:adaptive:smtp_conc:${job.clientId}:${selection.domain.id}`
    const conc = await redis.incr(concKey)
    if (conc === 1) await redis.expire(concKey, 30)
    if (conc > maxConcurrency) {
      await recordMetric(job.clientId, 'deferral_rate', 1, { scope: 'worker', reason: 'domain_concurrency_cap', maxConcurrency })
      throw new Error('retry_later:domain_concurrency_cap')
    }

    let messageId = ''
    let smtpAttempted = false
    try {
      const smtpHost = reqEnv('SMTP_HOST')
      const smtpUser = reqEnv('SMTP_USER')
      const smtpPass = reqEnv('SMTP_PASS')
      smtpAttempted = true

      const sent = await sendSmtp(
        { host: smtpHost, user: smtpUser, pass: smtpPass },
        {
          from: selection.identity.email,
          to: job.toEmail,
          subject: job.subject,
          html: job.html,
          text: job.text,
          headers: { 'X-Xavira-Lane': lane, 'X-Xavira-Adaptive': adaptive.reasons.join(',') },
        }
      )
      messageId = sent.messageId
    } finally {
      // Best-effort release: if process crashes, TTL expires.
      await redis.decr(concKey).catch(() => {})
    }

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
      metadata: {
        event_code: 'EMAIL_SENT',
        to_email: normalizedTo,
        idempotency_key: idemKey,
        adaptive: {
          throughput_current: effectiveMaxPerMinute,
          reasons: adaptive.reasons,
          next_window_action: adaptive.nextWindowAction,
          provider: recipientProvider,
          best_hours_utc: bestHours ?? null,
          in_best_window: timeWindowOk,
        },
      },
    })

    // Mark idempotency as completed after we successfully sent and tracked.
    await redis.set(doneKey, '1', { EX: 60 * 60 * 24 * 7 })
    await redis.set(legacyDoneKey, '1', { EX: 60 * 60 * 24 * 7 })
    await redis.del(inflightKey)
    await redis.del(failedKey)
    await recordMetric(job.clientId, 'send_success_rate', 1, { scope: 'worker' })
    await recordMetric(job.clientId, 'duplicate_send_prevented', 0, { scope: 'worker' })
  } catch (err) {
    const msg = (err as any)?.message ?? String(err)

    // Only emit FAILED tracking for real SMTP execution failures (not our own throttles).
    const isInternalThrottle =
      msg.startsWith('retry_later:adaptive_throttle') ||
      msg.startsWith('retry_later:global_cap') ||
      msg.startsWith('retry_later:domain_concurrency_cap') ||
      msg.startsWith('retry_later:inflight_lock') ||
      msg.startsWith('retry_later:recent_failure')

    if (!isInternalThrottle) {
      // Classify SMTP errors for deferral/block signals.
      const e: any = err
      const responseCode = Number(e?.responseCode ?? e?.code ?? e?.response?.statusCode ?? NaN)
      const response = String(e?.response ?? e?.message ?? '').toLowerCase()

      let smtpClass: 'deferral' | 'block' | 'other' = 'other'
      if (Number.isFinite(responseCode) && responseCode >= 400 && responseCode < 500) smtpClass = 'deferral'
      if (response.includes('rate') || response.includes('throttle') || response.includes('too many') || response.includes('temporarily rejected')) {
        smtpClass = 'block'
      }

      // Recipient-provider memory update: elevate risk for block/deferral and auto-decay.
      if (smtpClass === 'block' || smtpClass === 'deferral') {
        const pk = `xv:${REGION}:adaptive:provider_risk:${job.clientId}:${detectProvider(job.toEmail)}`
        const cur = Number((await redis.get(pk)) ?? 0)
        const next = Math.min(0.5, Math.max(cur, smtpClass === 'block' ? 0.3 : 0.15))
        await redis.set(pk, String(next), { EX: 60 * 60 }) // 1h TTL
        await recordMetric(job.clientId, smtpClass === 'block' ? 'block_rate' : 'deferral_rate', 1, { provider: detectProvider(job.toEmail) })
      }

      await handleTracking({
        type: 'FAILED',
        clientId: job.clientId,
        campaignId: job.campaignId ?? null,
        contactId: job.contactId ?? null,
        queueJobId: job.queueJobId ?? null,
        metadata: {
          event_code: 'EMAIL_FAILED',
          idempotency_key: idemKey,
          to_email: String(job.toEmail || '').trim().toLowerCase(),
          smtp_response_code: Number.isFinite(responseCode) ? responseCode : null,
          smtp_class: smtpClass,
          error: msg,
        },
      }).catch(() => {})
    }

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
