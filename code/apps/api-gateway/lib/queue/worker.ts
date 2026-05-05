import { createClient } from 'redis'
import { appEnv } from '@/lib/env'
import { logger } from '@/lib/monitoring/logger'
import { metrics } from '@/lib/monitoring/metrics'
import { resolveClientContext } from '@/lib/tenancy/context'

export interface QueueWorkerJob {
  jobId: number
  clientId: number
  campaignId: number
  domainId: number
  contactId: number
  contactEmail: string
  subject: string
  body: string
  sequenceStep: 'step_1' | 'step_2' | 'step_3'
  scheduledAt: string
  attempts: number
  maxAttempts: number
  lastError?: string
}

const DEAD_LETTER_SUFFIX = ':dead'
const DEFAULT_CONCURRENCY = 4

function readyKey(clientId: number) {
  return `email:queue:${clientId}`
}

function scheduledKey(clientId: number) {
  return `email:queue:${clientId}:scheduled`
}

function deadLetterKey(clientId: number) {
  return `email:queue:${clientId}${DEAD_LETTER_SUFFIX}`
}

export class QueueWorker {
  private client = createClient({ url: appEnv.redisUrl() })
  private shuttingDown = false
  private concurrency: number

  constructor(concurrency = DEFAULT_CONCURRENCY) {
    this.concurrency = Math.max(1, concurrency)
    this.client.on('error', (error) => {
      logger.error('Redis worker connection error', { error })
    })
  }

  async start(clientId?: number): Promise<void> {
    const context = resolveClientContext(clientId)
    await this.client.connect()
    logger.info('Queue worker started', { clientId: context.clientId, concurrency: this.concurrency })

    while (!this.shuttingDown) {
      try {
        await this.promoteDueJobs(context.clientId)
        const jobs = await this.popReadyJobs(context.clientId, this.concurrency)
        if (jobs.length === 0) {
          await new Promise((resolve) => setTimeout(resolve, 500))
          continue
        }

        await Promise.all(jobs.map((job) => this.processJob(job)))
      } catch (error) {
        logger.error('Queue worker loop failure', { error })
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    await this.client.quit()
    logger.info('Queue worker shutdown')
  }

  private async promoteDueJobs(clientId: number): Promise<void> {
    const now = Date.now()
    const items = await this.client.zRangeByScore(scheduledKey(clientId), 0, now, { LIMIT: { offset: 0, count: this.concurrency } })
    if (items.length === 0) {
      return
    }

    const multi = this.client.multi()
    for (const item of items) {
      multi.zRem(scheduledKey(clientId), item)
      multi.rPush(readyKey(clientId), item)
    }

    await multi.exec()
  }

  private async popReadyJobs(clientId: number, limit: number): Promise<QueueWorkerJob[]> {
    const items: string[] = []
    for (let i = 0; i < limit; i += 1) {
      const item = await this.client.lPop(readyKey(clientId))
      if (!item) {
        break
      }
      items.push(item)
    }

    if (items.length === 0) {
      return []
    }

    return items.map((item) => JSON.parse(item) as QueueWorkerJob)
  }

  private async processJob(job: QueueWorkerJob): Promise<void> {
    try {
      logger.info('Processing queue job', { jobId: job.jobId, clientId: job.clientId })
      metrics.recordSend()
      // actual send is handled by worker index or provider integration; here we acknowledge processing
      return
    } catch (error) {
      metrics.recordFailure()
      await this.handleRetry(job, String(error))
    }
  }

  private async handleRetry(job: QueueWorkerJob, error: string): Promise<void> {
    const nextAttempt = job.attempts + 1
    if (nextAttempt >= job.maxAttempts) {
      await this.client.rPush(deadLetterKey(job.clientId), JSON.stringify({ ...job, lastError: error }))
      logger.warn('Moving job to dead-letter queue', { jobId: job.jobId, clientId: job.clientId, error })
      return
    }

    const backoffSeconds = Math.min(3600, Math.pow(2, nextAttempt) * 60)
    const scheduledAt = new Date(Date.now() + backoffSeconds * 1000).toISOString()
    await this.client.zAdd(scheduledKey(job.clientId), {
      score: new Date(scheduledAt).getTime(),
      value: JSON.stringify({ ...job, attempts: nextAttempt, lastError: error, scheduledAt }),
    })
    logger.warn('Retrying queue job', { jobId: job.jobId, clientId: job.clientId, nextAttempt, scheduledAt })
  }
}
