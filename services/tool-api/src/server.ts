import 'dotenv/config'
import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'
import IORedis from 'ioredis'
import { Pool } from 'pg'
import { Queue } from 'bullmq'
import { z } from 'zod'
import type { DbExecutor, Lane, TrackingIngestEvent, ValidationVerdict } from '@xavira/types'
import { resolveClientIdFromRequest } from './auth'
import { computeGlobalIntelligence } from '@xavira/intelligence-engine'
import { simulate } from '@xavira/simulation-engine'
import { decideAdvanced } from '@xavira/decision-engine'
import { ingestEvent } from '@xavira/tracking-engine'
import { updateDomainStats, getDomainScore, shouldPauseDomain } from '@xavira/reputation-engine'
import { detectProvider, getProviderPolicy } from '@xavira/provider-engine'
import crypto from 'crypto'

function reqEnv(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

const app = Fastify({ logger: true })

const pool = new Pool({ connectionString: reqEnv('DATABASE_URL') })
const redis = new IORedis(reqEnv('REDIS_URL'))

const db: DbExecutor = async (sql, params = []) => {
  const res = await pool.query(sql, params as any[])
  return { rows: res.rows as any[], rowCount: res.rowCount ?? 0 }
}

function tenantSendQueueName(clientId: number) {
  // Adapter-mode: keep a stable single queue name unless you choose to enable per-tenant queues later.
  return process.env.SEND_QUEUE ?? 'xv-send-queue'
}

// Simple Redis usage counters for tool API.
async function recordToolUsage(clientId: number, endpoint: string) {
  const key = `xv:tool:usage:${clientId}:${endpoint}:${new Date().toISOString().slice(0, 10)}`
  await redis.incr(key)
  await redis.expire(key, 7 * 24 * 60 * 60)
}

const SendJobSchema = z.object({
  toEmail: z.string().min(3),
  subject: z.string().min(1),
  html: z.string().optional(),
  text: z.string().optional(),
  campaignId: z.number().int().optional(),
  contactId: z.number().int().optional(),
  queueJobId: z.number().int().optional(),
})

const ValidateSchema = z.object({
  email: z.string().min(3),
})

async function lookupValidation(email: string): Promise<{ verdict: ValidationVerdict; score: number; catchAll?: boolean } | null> {
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
  if (!row) return null
  const catchAll = Boolean((row as any).catch_all?.isCatchAll ?? (row as any).catch_all?.catchAll)
  return { verdict: row.verdict, score: Number(row.score ?? 0), catchAll }
}

async function bestDomainForClient(clientId: number): Promise<{ id: number; domain: string } | null> {
  const res = await db<{ id: number; domain: string }>(
    `SELECT id, domain
     FROM domains
     WHERE client_id = $1
       AND status = 'active'
     ORDER BY health_score DESC, bounce_rate ASC
     LIMIT 1`,
    [clientId]
  )
  return res.rows[0] ?? null
}

async function track(event: TrackingIngestEvent) {
  await ingestEvent({ db }, event)
  await updateDomainStats({ db }, event)
}

app.addHook('preHandler', async (request, reply) => {
  const clientId = resolveClientIdFromRequest({ headers: request.headers as any })
  if (!clientId) {
    reply.code(401)
    throw new Error('Unauthorized (missing or invalid API key)')
  }
  ;(request as any).clientId = clientId
})

await app.register(rateLimit, {
  global: false,
})

app.post('/tool/validate', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request) => {
  const clientId = (request as any).clientId as number
  await recordToolUsage(clientId, 'validate')
  const body = ValidateSchema.parse(request.body)

  const existing = await lookupValidation(body.email)
  if (existing) {
    return { ok: true, email: body.email, ...existing, source: 'db' as const }
  }

  // Deterministic: we don't run network SMTP checks here.
  // In a full setup, this would enqueue validator-engine jobs and return {pending:true}.
  return { ok: true, email: body.email, verdict: 'unknown' as const, score: 0.5, pending: true }
})

app.post('/tool/send', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
  const clientId = (request as any).clientId as number
  await recordToolUsage(clientId, 'send')
  const body = SendJobSchema.parse(request.body)

  const provider = detectProvider(body.toEmail)
  const providerPolicy = getProviderPolicy(provider)

  const validation = await lookupValidation(body.toEmail)
  if (!validation) {
    // Cannot bypass validation.
    return reply.code(409).send({ ok: false, error: 'validation_missing', message: 'No validator result yet for this email.' })
  }

  const domain = await bestDomainForClient(clientId)
  if (!domain) return reply.code(409).send({ ok: false, error: 'no_domain', message: 'No active domain configured.' })

  const paused = await shouldPauseDomain({ db }, clientId, domain.id)
  if (paused) {
    return reply.code(423).send({ ok: false, error: 'domain_paused', message: 'Domain is paused for safety.' })
  }

  const intelligence = await computeGlobalIntelligence({ db }, clientId)

  // Simulation runs before decision.
  const sim = await simulate(
    { db },
    {
      clientId,
      domainId: domain.id,
      identityId: 0,
      lane: providerPolicy.laneBias ?? 'normal',
    }
  )

  const domainScore = (await getDomainScore({ db }, clientId, domain.id))?.score ?? intelligence.global_domain_score
  const decision = decideAdvanced({
    verdict: validation.verdict,
    domainHealthy: intelligence.global_domain_score >= 0.6,
    simulation: sim,
    revenueProbability: 0.5,
  })

  if (decision.action === 'drop') {
    await track({
      type: 'FAILED',
      clientId,
      campaignId: body.campaignId ?? null,
      contactId: body.contactId ?? null,
      queueJobId: body.queueJobId ?? null,
      metadata: { event_code: 'EMAIL_FAILED', reason: decision.reason },
    })
    return { ok: false, error: 'dropped', reason: decision.reason }
  }

  const lane: Lane =
    decision.action === 'send_now' || decision.action === 'send_later' || decision.action === 'shift_domain'
      ? decision.lane
      : 'normal'

  const finalLane = providerPolicy.laneBias ?? lane

  // Enforce control plane: we enqueue; the worker does the sending.
  const q = new Queue(tenantSendQueueName(clientId), { connection: { url: reqEnv('REDIS_URL') } })
  const delayMs = decision.action === 'send_later' ? Math.max(0, decision.delayMs) : 0

  // Idempotency key: stable per "decision -> enqueue -> send" unit.
  // For tool sends, we scope it by (email + campaignId + queueJobId) when available.
  const normalizedEmail = String(body.toEmail || '').trim().toLowerCase()
  const idempotencyKeyPayload = `${clientId}|${normalizedEmail}|${body.campaignId ?? 0}|${body.queueJobId ?? 0}|${body.contactId ?? 0}`
  const idempotencyKey = crypto.createHash('sha256').update(idempotencyKeyPayload).digest('hex').slice(0, 40)

  const job = await q.add(
    'tool_send',
    {
      clientId,
      campaignId: body.campaignId,
      contactId: body.contactId,
      queueJobId: body.queueJobId,
      toEmail: body.toEmail,
      subject: body.subject,
      html: body.html,
      text: body.text,
      lane: finalLane,
      provider,
      domainScore,
      simulation: sim,
      idempotencyKey,
    },
    {
      delay: delayMs,
      // If the same tool call is retried by an integration, BullMQ will dedupe by jobId.
      jobId: `tool_send:${clientId}:${idempotencyKey}`,
      attempts: 6,
      backoff: { type: 'exponential', delay: 60_000 },
    }
  )

  return {
    ok: true,
    enqueue: {
      queue: tenantSendQueueName(clientId),
      jobId: job.id,
      delayMs,
      lane: finalLane,
      provider,
      predicted: sim,
    },
  }
})

app.get('/tool/status', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request) => {
  const clientId = (request as any).clientId as number
  await recordToolUsage(clientId, 'status')
  const domains = await db<{ total: string; active: string; paused: string }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(CASE WHEN status='active' THEN 1 END)::text AS active,
       COUNT(CASE WHEN status='paused' THEN 1 END)::text AS paused
     FROM domains
     WHERE client_id = $1`,
    [clientId]
  )
  const lastEvents = await db<{ event_type: string; created_at: string }>(
    `SELECT event_type, created_at::text
     FROM events
     WHERE client_id = $1
     ORDER BY created_at DESC
     LIMIT 20`,
    [clientId]
  )
  return { ok: true, clientId, domains: domains.rows[0], lastEvents: lastEvents.rows }
})

app.get('/tool/domain-health', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request) => {
  const clientId = (request as any).clientId as number
  await recordToolUsage(clientId, 'domain_health')
  const domainIdRaw = (request.query as any)?.domainId
  const domainId = domainIdRaw ? Number(domainIdRaw) : NaN
  if (!Number.isFinite(domainId)) {
    return { ok: false, error: 'missing_domainId' }
  }
  const score = await getDomainScore({ db }, clientId, domainId)
  const paused = await shouldPauseDomain({ db }, clientId, domainId)
  const intelligence = await computeGlobalIntelligence({ db }, clientId)
  return { ok: true, domainId, score, paused, global: intelligence }
})

async function main() {
  const port = Number(process.env.TOOL_API_PORT ?? 8787)
  await app.listen({ port, host: '0.0.0.0' })
}

main().catch((err) => {
  app.log.error(err)
  process.exit(1)
})
