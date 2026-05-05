import 'dotenv/config'
import { Worker } from 'bullmq'
import { validatorEnv } from './config'
import { createRedis } from './cache'
import { ensureValidatorTables, insertValidation } from './db'
import { createQueue, DOMAIN_AUTH_QUEUE, VALIDATION_QUEUE_BULK, VALIDATION_QUEUE_HIGH } from './queue'
import { validateOne } from './pipeline'
import { runDomainAuthCheck } from './dmarc'

type JobPayload = { email: string }
type DomainJob = { domain: string }

async function main() {
  await ensureValidatorTables()
  const redis = createRedis()

  const domainQueue = createQueue(DOMAIN_AUTH_QUEUE)

  const makeWorker = (queueName: string, concurrency: number) => {
    const w = new Worker<JobPayload>(
      queueName,
      async (job) => {
        const res = await validateOne({ email: job.data.email, redis, domainQueue })
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
        return res
      },
      {
        connection: { url: validatorEnv.redisUrl() },
        concurrency,
        lockDuration: 30_000,
      }
    )
    w.on('failed', (job, err) => {
      console.error('[validator-worker] job failed', { queue: queueName, id: job?.id, email: (job as any)?.data?.email, err: err?.message })
    })
    return w
  }

  // Process high priority first by dedicating a worker with reserved concurrency.
  makeWorker(VALIDATION_QUEUE_HIGH, Math.max(1, Math.floor(validatorEnv.concurrency() * 0.25)))
  makeWorker(VALIDATION_QUEUE_BULK, Math.max(1, Math.floor(validatorEnv.concurrency() * 0.75)))

  const domainWorker = new Worker<DomainJob>(
    DOMAIN_AUTH_QUEUE,
    async (job) => {
      return await runDomainAuthCheck(redis, job.data.domain)
    },
    { connection: { url: validatorEnv.redisUrl() }, concurrency: 10 }
  )
  domainWorker.on('failed', (job, err) => {
    console.error('[validator-domain-worker] failed', { id: job?.id, domain: (job as any)?.data?.domain, err: err?.message })
  })

  console.log('[validator-worker] running', {
    hpQueue: VALIDATION_QUEUE_HIGH,
    bulkQueue: VALIDATION_QUEUE_BULK,
    domainQueue: DOMAIN_AUTH_QUEUE,
    concurrency: validatorEnv.concurrency(),
  })
}

main().catch((err) => {
  console.error('[validator-worker] fatal', err)
  process.exit(1)
})
