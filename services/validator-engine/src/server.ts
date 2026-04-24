import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { z } from 'zod'
import { validatorEnv } from './config'
import { createRedis } from './cache'
import { ensureValidatorTables, insertValidation } from './db'
import { validateOne } from './pipeline'
import { createQueue, VALIDATION_QUEUE_BULK, VALIDATION_QUEUE_HIGH } from './queue'

const ValidateReq = z.object({ email: z.string().min(3) })
const BulkReq = z.object({ emails: z.array(z.string().min(3)).min(1).max(500) })

async function main() {
  await ensureValidatorTables()
  const redis = createRedis()
  const bulkQueue = createQueue(VALIDATION_QUEUE_BULK)
  const highQueue = createQueue(VALIDATION_QUEUE_HIGH)

  const app = Fastify({ logger: true })
  await app.register(cors, { origin: true })
  await app.register(rateLimit, { max: 60, timeWindow: '1 minute' })

  app.get('/health', async () => ({ ok: true }))

  // Synchronous validation (single email)
  app.post('/validate', async (req, reply) => {
    const parsed = ValidateReq.safeParse((req as any).body)
    if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() })

    const res = await validateOne({ email: parsed.data.email, redis })
    await insertValidation({
      email: res.email,
      normalizedEmail: res.normalizedEmail,
      domain: res.meta.domain,
      verdict: res.verdict,
      score: res.score,
      reasons: res.reasons,
      mx: res.mx,
      smtp: res.smtp,
      catchAll: res.catchAll,
    })
    return { ok: true, result: res }
  })

  // Asynchronous bulk validation via BullMQ
  app.post('/bulk-validate', async (req, reply) => {
    const parsed = BulkReq.safeParse((req as any).body)
    if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() })

    const priority = String(((req as any).body as any)?.priority ?? '').toLowerCase() === 'high' ? 'high' : 'bulk'
    const queue = priority === 'high' ? highQueue : bulkQueue

    const jobs = await queue.addBulk(
      parsed.data.emails.map((email) => ({
        name: 'validate',
        data: { email },
      }))
    )

    return { ok: true, queue: priority, enqueued: jobs.length, jobIds: jobs.map((j) => String(j.id)) }
  })

  app.get('/metrics', async () => {
    const raw = await redis.hgetall('xv:validator:metrics')
    const toNum = (v: string | undefined) => Number(v ?? 0)
    const total = toNum(raw.total_validations)
    const disposable = toNum(raw.disposable_filtered)
    const smtpOk = toNum(raw.smtp_success)
    const smtpFail = toNum(raw.smtp_failures)
    const catchAllTrue = toNum(raw.catch_all_true)
    const catchAllTotal = toNum(raw.catch_all_total)

    return {
      ok: true,
      counters: raw,
      rates: {
        disposable_filter_rate: total > 0 ? disposable / total : 0,
        smtp_success_rate: smtpOk + smtpFail > 0 ? smtpOk / (smtpOk + smtpFail) : 0,
        catch_all_rate: catchAllTotal > 0 ? catchAllTrue / catchAllTotal : 0,
      },
    }
  })

  const port = validatorEnv.apiPort()
  await app.listen({ port, host: '0.0.0.0' })
  app.log.info({ port }, 'validator api listening')
}

main().catch((err) => {
  console.error('[validator-api] fatal', err)
  process.exit(1)
})
