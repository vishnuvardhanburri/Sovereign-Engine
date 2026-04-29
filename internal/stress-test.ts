import 'dotenv/config'
import crypto from 'crypto'
import IORedis from 'ioredis'
import { Pool } from 'pg'

type QueryRow = Record<string, any>

function reqEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : fallback
}

function boolEnv(name: string, fallback = false): boolean {
  const raw = process.env[name]
  if (raw == null) return fallback
  return ['1', 'true', 'yes', 'y', 'on'].includes(raw.toLowerCase())
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const pool = new Pool({ connectionString: reqEnv('DATABASE_URL') })
const redis = new IORedis(reqEnv('REDIS_URL'))

async function db<T extends QueryRow = QueryRow>(sql: string, params: unknown[] = []) {
  const res = await pool.query(sql, params as any[])
  return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 }
}

async function scanSenderHeartbeats(region: string) {
  const pattern = `xv:${region}:workers:sender:*`
  let cursor = '0'
  const keys: string[] = []

  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
    cursor = next
    keys.push(...batch)
  } while (cursor !== '0')

  if (!keys.length) return []
  const values = await redis.mget(...keys)
  return values
    .map((value) => {
      if (!value) return null
      try {
        return JSON.parse(value) as { workerId?: string; mockSmtp?: boolean; concurrency?: number }
      } catch {
        return null
      }
    })
    .filter(Boolean) as Array<{ workerId?: string; mockSmtp?: boolean; concurrency?: number }>
}

async function ensureStressFixtures(clientId: number, runId: string, count: number) {
  const domain = process.env.STRESS_SENDING_DOMAIN || 'stress.local'
  const fromEmail = process.env.STRESS_FROM_EMAIL || `scale-proof@${domain}`

  const domainRes = await db<{ id: string }>(
    `INSERT INTO domains (
       client_id, domain, status, spf_valid, dkim_valid, dmarc_valid,
       daily_limit, daily_cap, health_score, bounce_rate, spam_rate
     )
     VALUES ($1,$2,'active',TRUE,TRUE,TRUE,$3,$3,100,0,0)
     ON CONFLICT (client_id, domain)
     DO UPDATE SET
       status = 'active',
       paused = FALSE,
       spf_valid = TRUE,
       dkim_valid = TRUE,
       dmarc_valid = TRUE,
       daily_limit = EXCLUDED.daily_limit,
       daily_cap = EXCLUDED.daily_cap,
       health_score = 100,
       bounce_rate = 0,
       spam_rate = 0,
       updated_at = CURRENT_TIMESTAMP
     RETURNING id`,
    [clientId, domain, Math.max(500_000, count)]
  )
  const domainId = Number(domainRes.rows[0]!.id)

  await db(
    `INSERT INTO reputation_state (
       client_id, domain_id, provider, state, max_per_hour, max_per_minute,
       max_concurrency, cooldown_until, reasons, metrics_snapshot
     )
     SELECT $1, $2, provider, 'normal', $3, $4, 50, NULL, '["stress_fastlane"]'::jsonb, $5::jsonb
     FROM (VALUES ('gmail'), ('outlook'), ('yahoo'), ('other')) AS lanes(provider)
     ON CONFLICT (client_id, domain_id, provider)
     DO UPDATE SET
       state = 'normal',
       max_per_hour = EXCLUDED.max_per_hour,
       max_per_minute = EXCLUDED.max_per_minute,
       max_concurrency = EXCLUDED.max_concurrency,
       cooldown_until = NULL,
       reasons = EXCLUDED.reasons,
       metrics_snapshot = EXCLUDED.metrics_snapshot,
       updated_at = now()`,
    [
      clientId,
      domainId,
      Math.max(500_000, count * 10),
      Math.max(10_000, count),
      JSON.stringify({ stress: true, runId, metrics: { deferralRate1h: 0, blockRate1h: 0, seedPlacementInboxRate: 1 } }),
    ]
  )

  await db(
    `INSERT INTO identities (client_id, domain_id, email, daily_limit, status)
     VALUES ($1,$2,$3,$4,'active')
     ON CONFLICT (client_id, email)
     DO UPDATE SET
       domain_id = EXCLUDED.domain_id,
       daily_limit = EXCLUDED.daily_limit,
       status = 'active',
       updated_at = CURRENT_TIMESTAMP`,
    [clientId, domainId, fromEmail, Math.max(500_000, count)]
  )

  const sequenceRes = await db<{ id: string }>(
    `INSERT INTO sequences (client_id, name)
     VALUES ($1,$2)
     RETURNING id`,
    [clientId, `Scale Proof ${runId}`]
  )
  const sequenceId = Number(sequenceRes.rows[0]!.id)

  await db(
    `INSERT INTO sequence_steps (sequence_id, step_index, subject, body, touch_label, variant_key)
     VALUES ($1,0,$2,$3,'stress-proof','primary')`,
    [
      sequenceId,
      `Xavira Orbit scale proof ${runId}`,
      `This is an internal mock delivery used to prove Xavira Orbit queue throughput. Run ${runId}.`,
    ]
  )

  const campaignRes = await db<{ id: string }>(
    `INSERT INTO campaigns (
       client_id, sequence_id, name, status, duration_days, audience_mode,
       contact_count, daily_target, active_lead_count
     )
     VALUES ($1,$2,$3,'active',1,'manual',$4,$4,$4)
     RETURNING id`,
    [clientId, sequenceId, `Scale Proof ${runId}`, count]
  )

  return { domainId, sequenceId, campaignId: Number(campaignRes.rows[0]!.id) }
}

async function createContacts(clientId: number, runId: string, count: number) {
  const contacts: Array<{ email: string; name: string }> = Array.from({ length: count }, (_, i) => ({
    email: `stress-${runId}-${i}@example.test`,
    name: `Stress Contact ${i}`,
  }))

  const out: Array<{ id: number; email: string }> = []
  for (const batch of chunks(contacts, 500)) {
    const values: string[] = []
    const params: unknown[] = []
    batch.forEach((contact, index) => {
      const base = index * 4
      params.push(clientId, contact.email, contact.name, 'stress')
      values.push(`($${base + 1},$${base + 2},split_part($${base + 2},'@',2),$${base + 3},$${base + 4},'valid','active')`)
    })

    const res = await db<{ id: string; email: string }>(
      `INSERT INTO contacts (
         client_id, email, email_domain, name, source, verification_status, status
       )
       VALUES ${values.join(',')}
       ON CONFLICT (client_id, email)
       DO UPDATE SET
         verification_status = 'valid',
         status = 'active',
         source = 'stress',
         updated_at = CURRENT_TIMESTAMP
       RETURNING id, email`,
      params
    )
    out.push(...res.rows.map((row) => ({ id: Number(row.id), email: row.email })))
  }

  return out
}

async function createValidationRows(contacts: Array<{ email: string }>) {
  for (const batch of chunks(contacts, 500)) {
    const values: string[] = []
    const params: unknown[] = []
    batch.forEach((contact, index) => {
      const base = index * 4
      params.push(contact.email, contact.email.toLowerCase(), contact.email.split('@')[1], JSON.stringify(['stress_mock_valid']))
      values.push(`($${base + 1},$${base + 2},$${base + 3},'valid',0.99,$${base + 4}::jsonb,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb)`)
    })
    await db(
      `INSERT INTO email_validations (
         email, normalized_email, domain, verdict, score, reasons, mx, smtp, catch_all
       )
       VALUES ${values.join(',')}`,
      params
    )
  }
}

async function createQueueJobs(input: {
  clientId: number
  campaignId: number
  contacts: Array<{ id: number; email: string }>
  runId: string
}) {
  const out: Array<{ id: number; contactId: number; idempotencyKey: string }> = []

  for (const batch of chunks(input.contacts, 500)) {
    const values: string[] = []
    const params: unknown[] = []
    batch.forEach((contact, index) => {
      const idempotencyKey = crypto
        .createHash('sha256')
        .update(`${input.runId}|${input.campaignId}|${contact.id}|${contact.email}`)
        .digest('hex')
        .slice(0, 40)
      const metadata = JSON.stringify({ stress: true, runId: input.runId })
      const base = index * 7
      params.push(input.clientId, contact.id, input.campaignId, contact.email, idempotencyKey, metadata, new Date())
      values.push(`($${base + 1},$${base + 2},$${base + 3},0,$${base + 7},$${base + 4},$${base + 5},$${base + 6}::jsonb,6)`)
    })

    const res = await db<{ id: string; contact_id: string; idempotency_key: string }>(
      `INSERT INTO queue_jobs (
         client_id, contact_id, campaign_id, sequence_step, scheduled_at,
         recipient_email, idempotency_key, metadata, max_attempts
       )
       VALUES ${values.join(',')}
       ON CONFLICT (campaign_id, contact_id, sequence_step)
       DO UPDATE SET
         status = 'pending',
         attempts = 0,
         scheduled_at = EXCLUDED.scheduled_at,
         recipient_email = EXCLUDED.recipient_email,
         idempotency_key = EXCLUDED.idempotency_key,
         metadata = EXCLUDED.metadata,
         provider_message_id = NULL,
         completed_at = NULL,
         last_error = NULL,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id, contact_id, idempotency_key`,
      params
    )
    out.push(
      ...res.rows.map((row) => ({
        id: Number(row.id),
        contactId: Number(row.contact_id),
        idempotencyKey: row.idempotency_key,
      }))
    )
  }

  return out
}

async function enqueueLegacyJobs(input: {
  clientId: number
  campaignId: number
  queueJobs: Array<{ id: number; contactId: number; idempotencyKey: string }>
}) {
  const readyQueue = process.env.LEGACY_READY_QUEUE ?? 'email:queue'
  const scheduledAt = new Date().toISOString()

  for (const batch of chunks(input.queueJobs, 1000)) {
    const payloads = batch.map((job) =>
      JSON.stringify({
        id: job.id,
        client_id: input.clientId,
        campaign_id: input.campaignId,
        contact_id: job.contactId,
        sequence_step: 0,
        scheduled_at: scheduledAt,
        idempotency_key: job.idempotencyKey,
      })
    )
    await redis.rpush(readyQueue, ...payloads)
  }
}

async function waitForCompletion(clientId: number, campaignId: number, count: number, timeoutMs: number) {
  const started = Date.now()
  let lastSent = 0
  let lastFailed = 0

  while (Date.now() - started < timeoutMs) {
    const res = await db<{ sent: string; failed: string; completed_jobs: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE e.event_type = 'sent')::text AS sent,
         COUNT(*) FILTER (WHERE e.event_type = 'failed')::text AS failed,
         (SELECT COUNT(*)::text FROM queue_jobs qj WHERE qj.client_id = $1 AND qj.campaign_id = $2 AND qj.status = 'completed') AS completed_jobs
       FROM events e
       WHERE e.client_id = $1 AND e.campaign_id = $2`,
      [clientId, campaignId]
    )
    const row = res.rows[0]
    lastSent = Number(row?.sent ?? 0)
    lastFailed = Number(row?.failed ?? 0)
    const completedJobs = Number(row?.completed_jobs ?? 0)

    process.stdout.write(
      `\r[stress] processed sent=${lastSent}/${count} failed=${lastFailed} completed_jobs=${completedJobs}/${count}`
    )

    if (lastSent + lastFailed >= count || completedJobs >= count) {
      process.stdout.write('\n')
      return { sent: lastSent, failed: lastFailed, elapsedMs: Date.now() - started }
    }
    await sleep(1000)
  }

  process.stdout.write('\n')
  return { sent: lastSent, failed: lastFailed, elapsedMs: Date.now() - started, timedOut: true }
}

async function main() {
  const clientId = intEnv('STRESS_CLIENT_ID', intEnv('DEFAULT_CLIENT_ID', 1))
  const count = intEnv('STRESS_COUNT', 10_000)
  const timeoutMs = intEnv('STRESS_TIMEOUT_MS', 120_000)
  const region = process.env.XV_REGION ?? 'local'
  const runId = process.env.STRESS_RUN_ID ?? `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
  const enqueueOnly = boolEnv('STRESS_ENQUEUE_ONLY', false)
  const allowRealSmtp = boolEnv('ALLOW_REAL_SMTP_STRESS', false)

  const heartbeats = await scanSenderHeartbeats(region)
  if (!heartbeats.length && !enqueueOnly) {
    throw new Error(
      `No sender-worker heartbeat found for region "${region}". Start one first: MOCK_SMTP=true MOCK_SMTP_FASTLANE=true SENDER_WORKER_CONCURRENCY=50 pnpm worker:sender`
    )
  }
  if (!allowRealSmtp && heartbeats.some((node) => node.mockSmtp === false)) {
    throw new Error('Refusing stress test because at least one sender-worker heartbeat reports mockSmtp=false.')
  }

  console.log('[stress] starting Xavira Orbit scale proof', {
    clientId,
    count,
    runId,
    region,
    activeSenderWorkers: heartbeats.length,
    totalConcurrency: heartbeats.reduce((sum, node) => sum + Number(node.concurrency ?? 0), 0),
  })

  const setupStarted = Date.now()
  const fixtures = await ensureStressFixtures(clientId, runId, count)
  const contacts = await createContacts(clientId, runId, count)
  await createValidationRows(contacts)
  const queueJobs = await createQueueJobs({ clientId, campaignId: fixtures.campaignId, contacts, runId })
  await enqueueLegacyJobs({ clientId, campaignId: fixtures.campaignId, queueJobs })
  const setupElapsedMs = Date.now() - setupStarted

  console.log('[stress] enqueued mock pipeline jobs', {
    campaignId: fixtures.campaignId,
    domainId: fixtures.domainId,
    queueJobs: queueJobs.length,
    setupElapsedMs,
  })

  if (enqueueOnly) return

  const result = await waitForCompletion(clientId, fixtures.campaignId, count, timeoutMs)
  const totalElapsedMs = setupElapsedMs + result.elapsedMs
  const throughputPerSecond = Math.round((Math.max(result.sent, 1) / Math.max(totalElapsedMs / 1000, 1)) * 100) / 100

  console.log('[stress] complete', {
    sent: result.sent,
    failed: result.failed,
    setupElapsedMs,
    processingElapsedMs: result.elapsedMs,
    totalElapsedMs,
    throughputPerSecond,
    timedOut: Boolean((result as any).timedOut),
  })

  if ((result as any).timedOut || result.sent < count) {
    process.exitCode = 1
  }
}

main()
  .catch((err) => {
    console.error('[stress] failed', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await Promise.allSettled([redis.quit(), pool.end()])
  })
