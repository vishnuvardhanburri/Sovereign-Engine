import { createClient } from 'redis'
import { appEnv } from '@/lib/env'

export interface RedisQueueJobPayload {
  id: number
  client_id: number
  contact_id: number
  campaign_id: number
  domain_id?: number
  sequence_step: number
  scheduled_at: string
  attempts?: number
  max_attempts?: number
  idempotency_key?: string
  _raw?: string
  [key: string]: unknown
}

const READY_QUEUE_KEY = 'email:queue'
const SCHEDULED_QUEUE_KEY = 'email:queue:scheduled'
const PROCESSING_QUEUE_KEY = 'email:queue:processing'
const VISIBILITY_ZSET_KEY = 'email:queue:visibility'
const DEAD_LETTER_QUEUE_KEY = 'email:queue:dead'
const IDEMPOTENCY_KEY_PREFIX = 'email:idem:'
const IDEMPOTENCY_EMAIL_PREFIX = 'email:idem:email:'

let redisClient: any
let connectPromise: Promise<any> | undefined

async function getRedisClient(): Promise<any> {
  if (redisClient?.isOpen) {
    return redisClient
  }

  if (!connectPromise) {
    const client = createClient({
      url: appEnv.redisUrl(),
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 250, 3000),
      },
    })

    client.on('error', (error) => {
      console.error('[Redis] Client error', error)
    })

    connectPromise = client.connect().then(() => {
      redisClient = client
      return client
    })
  }

  return connectPromise
}

export async function enqueueQueueJobs(
  jobs: Array<RedisQueueJobPayload | Record<string, unknown>>
): Promise<void> {
  if (jobs.length === 0) {
    return
  }

  const client = await getRedisClient()
  const now = Date.now()
  const readyJobs: string[] = []
  const scheduledJobs: Array<{ score: number; value: string }> = []

  for (const job of jobs) {
    const serialized = JSON.stringify(job)
    const scheduledAt = new Date(job.scheduled_at as string).getTime()
    if (Number.isNaN(Number(job.client_id))) {
      throw new Error('enqueueQueueJobs: client_id must be a valid number')
    }

    // Idempotency: prevent duplicate queue pushes for the same job id.
    const jobId = Number((job as RedisQueueJobPayload).id)
    if (Number.isFinite(jobId) && jobId > 0) {
      const key = `${IDEMPOTENCY_KEY_PREFIX}${jobId}`
      const ok = await client.set(key, '1', { NX: true, EX: 60 * 60 * 24 * 7 })
      if (!ok) {
        continue
      }
    }

    // Additional idempotency layer: de-dupe on recipient/campaign/step key when available.
    // This protects against multiple contacts sharing the same email and producing multiple jobs.
    const emailKey = (job as RedisQueueJobPayload).idempotency_key
    if (emailKey && Number.isFinite(Number((job as any).client_id))) {
      const key = `${IDEMPOTENCY_EMAIL_PREFIX}${(job as any).client_id}:${emailKey}`
      const ok = await client.set(key, '1', { NX: true, EX: 60 * 60 * 24 * 30 })
      if (!ok) {
        continue
      }
    }

    if (scheduledAt <= now) {
      readyJobs.push(serialized)
    } else {
      scheduledJobs.push({ score: scheduledAt, value: serialized })
    }
  }

  const multi = client.multi()

  for (const item of readyJobs) {
    multi.rPush(READY_QUEUE_KEY, item)
  }

  for (const item of scheduledJobs) {
    multi.zAdd(SCHEDULED_QUEUE_KEY, {
      score: item.score,
      value: item.value,
    })
  }

  await multi.exec()
}

export async function enqueueQueueJob(job: RedisQueueJobPayload | Record<string, unknown>): Promise<void> {
  await enqueueQueueJobs([job])
}

export async function requeueQueueJob(
  job: RedisQueueJobPayload,
  scheduledAt: Date
): Promise<void> {
  await enqueueQueueJob({
    ...job,
    scheduled_at: scheduledAt.toISOString(),
  })
}

export async function promoteDueQueueJobs(limit: number): Promise<number> {
  const client = await getRedisClient()
  const now = Date.now()
  const dueItems = await client.zRangeByScore(
    SCHEDULED_QUEUE_KEY,
    0,
    now,
    {
      LIMIT: {
        offset: 0,
        count: limit,
      },
    }
  )

  if (dueItems.length === 0) {
    return 0
  }

  const multi = client.multi()
  for (const item of dueItems) {
    multi.zRem(SCHEDULED_QUEUE_KEY, item)
    multi.rPush(READY_QUEUE_KEY, item)
  }
  await multi.exec()

  return dueItems.length
}

export async function popReadyQueueJob(): Promise<RedisQueueJobPayload | null> {
  const client = await getRedisClient()
  const item = await client.lMove(READY_QUEUE_KEY, PROCESSING_QUEUE_KEY, 'LEFT', 'RIGHT')
  if (!item) {
    return null
  }

  // Visibility timeout so a crash won't lose the job.
  const visibilitySeconds = 5 * 60
  await client.zAdd(VISIBILITY_ZSET_KEY, {
    score: Date.now() + visibilitySeconds * 1000,
    value: item,
  })

  const parsed = JSON.parse(item) as RedisQueueJobPayload
  parsed._raw = item
  return parsed
}

export async function getQueueLength(): Promise<number> {
  const client = await getRedisClient()
  const [ready, scheduled, processing] = await Promise.all([
    client.lLen(READY_QUEUE_KEY),
    client.zCard(SCHEDULED_QUEUE_KEY),
    client.lLen(PROCESSING_QUEUE_KEY),
  ])

  return ready + scheduled + processing
}

export async function getQueueBreakdown(): Promise<{ ready: number; scheduled: number; processing: number; total: number }> {
  const client = await getRedisClient()
  const [ready, scheduled, processing] = await Promise.all([
    client.lLen(READY_QUEUE_KEY),
    client.zCard(SCHEDULED_QUEUE_KEY),
    client.lLen(PROCESSING_QUEUE_KEY),
  ])

  return {
    ready,
    scheduled,
    processing,
    total: ready + scheduled + processing,
  }
}

export async function peekQueue(limit = 10): Promise<RedisQueueJobPayload[]> {
  const client = await getRedisClient()
  const ready = await client.lRange(READY_QUEUE_KEY, 0, Math.max(limit - 1, 0))

  return ready.map((item: string) => JSON.parse(item) as RedisQueueJobPayload)
}

export async function removeQueueJobsForContact(contactId: number): Promise<number> {
  const client = await getRedisClient()
  const readyItems = await client.lRange(READY_QUEUE_KEY, 0, -1)
  const scheduledItems = await client.zRangeWithScores(SCHEDULED_QUEUE_KEY, 0, -1)
  const processingItems = await client.lRange(PROCESSING_QUEUE_KEY, 0, -1)
  const visibilityItems = await client.zRangeWithScores(VISIBILITY_ZSET_KEY, 0, -1)
  let removed = 0

  const keepReady = readyItems.filter((item: string) => {
    try {
      const parsed = JSON.parse(item) as RedisQueueJobPayload
      const match = parsed.contact_id === contactId
      if (match) {
        removed += 1
      }
      return !match
    } catch {
      return true
    }
  })

  const keepScheduled = scheduledItems.filter((item: { score: number; value: string }) => {
    try {
      const parsed = JSON.parse(item.value) as RedisQueueJobPayload
      const match = parsed.contact_id === contactId
      if (match) {
        removed += 1
      }
      return !match
    } catch {
      return true
    }
  })

  const keepProcessing = processingItems.filter((item: string) => {
    try {
      const parsed = JSON.parse(item) as RedisQueueJobPayload
      const match = parsed.contact_id === contactId
      if (match) {
        removed += 1
      }
      return !match
    } catch {
      return true
    }
  })

  const keepVisibility = visibilityItems.filter((item: { score: number; value: string }) => {
    try {
      const parsed = JSON.parse(item.value) as RedisQueueJobPayload
      const match = parsed.contact_id === contactId
      return !match
    } catch {
      return true
    }
  })

  const multi = client.multi()
  multi.del(READY_QUEUE_KEY)
  if (keepReady.length > 0) {
    multi.rPush(READY_QUEUE_KEY, keepReady)
  }
  multi.del(SCHEDULED_QUEUE_KEY)
  if (keepScheduled.length > 0) {
    multi.zAdd(
      SCHEDULED_QUEUE_KEY,
      keepScheduled.map((item: { score: number; value: string }) => ({ score: item.score, value: item.value }))
    )
  }
  multi.del(PROCESSING_QUEUE_KEY)
  if (keepProcessing.length > 0) {
    multi.rPush(PROCESSING_QUEUE_KEY, keepProcessing)
  }
  multi.del(VISIBILITY_ZSET_KEY)
  if (keepVisibility.length > 0) {
    multi.zAdd(
      VISIBILITY_ZSET_KEY,
      keepVisibility.map((item: { score: number; value: string }) => ({ score: item.score, value: item.value }))
    )
  }
  await multi.exec()

  return removed
}

export async function ackProcessingJob(raw: string): Promise<void> {
  const client = await getRedisClient()
  const multi = client.multi()
  multi.lRem(PROCESSING_QUEUE_KEY, 1, raw)
  multi.zRem(VISIBILITY_ZSET_KEY, raw)
  await multi.exec()
}

export async function moveToDeadLetter(raw: string, reason: string): Promise<void> {
  const client = await getRedisClient()
  const multi = client.multi()
  multi.lRem(PROCESSING_QUEUE_KEY, 1, raw)
  multi.zRem(VISIBILITY_ZSET_KEY, raw)
  multi.rPush(DEAD_LETTER_QUEUE_KEY, JSON.stringify({ raw, reason, at: new Date().toISOString() }))
  await multi.exec()
}

export async function reclaimExpiredJobs(limit = 200): Promise<number> {
  const client = await getRedisClient()
  const due = await client.zRangeByScore(VISIBILITY_ZSET_KEY, 0, Date.now(), {
    LIMIT: { offset: 0, count: Math.max(1, limit) },
  })
  if (!due.length) return 0

  const multi = client.multi()
  for (const raw of due) {
    multi.zRem(VISIBILITY_ZSET_KEY, raw)
    multi.lRem(PROCESSING_QUEUE_KEY, 1, raw)
    multi.rPush(READY_QUEUE_KEY, raw)
  }
  await multi.exec()
  return due.length
}

export async function closeRedis(): Promise<void> {
  if (redisClient?.isOpen) {
    await redisClient.quit()
  }

  redisClient = undefined
  connectPromise = undefined
}
