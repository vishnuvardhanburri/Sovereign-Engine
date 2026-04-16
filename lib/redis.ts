import { createClient } from 'redis'
import { appEnv } from '@/lib/env'

export interface RedisQueueJobPayload {
  id: number
  client_id: number
  contact_id: number
  campaign_id: number
  sequence_step: number
  scheduled_at: string
}

// Redis list queue (FIFO) used by the worker.
const READY_QUEUE_KEY = 'email:queue'
// ZSET used for delayed retries and scheduled sends.
const SCHEDULED_QUEUE_KEY = 'email:queue:scheduled'

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
  jobs: RedisQueueJobPayload[]
): Promise<void> {
  if (jobs.length === 0) {
    return
  }

  const client = await getRedisClient()
  const multi = client.multi()
  const now = Date.now()

  for (const job of jobs) {
    const serialized = JSON.stringify(job)
    const scheduledAt = new Date(job.scheduled_at).getTime()

    if (scheduledAt <= now) {
      multi.rPush(READY_QUEUE_KEY, serialized)
    } else {
      multi.zAdd(SCHEDULED_QUEUE_KEY, {
        score: scheduledAt,
        value: serialized,
      })
    }
  }

  await multi.exec()
}

export async function enqueueQueueJob(job: RedisQueueJobPayload): Promise<void> {
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
  const item = await client.lPop(READY_QUEUE_KEY)
  return item ? (JSON.parse(item) as RedisQueueJobPayload) : null
}

export async function getQueueLength(): Promise<number> {
  const client = await getRedisClient()
  const [ready, scheduled] = await Promise.all([
    client.lLen(READY_QUEUE_KEY),
    client.zCard(SCHEDULED_QUEUE_KEY),
  ])

  return ready + scheduled
}

export async function peekQueue(limit = 10): Promise<RedisQueueJobPayload[]> {
  const client = await getRedisClient()
  const ready = await client.lRange(READY_QUEUE_KEY, 0, Math.max(limit - 1, 0))

  return ready.map((item: string) => JSON.parse(item) as RedisQueueJobPayload)
}

export async function closeRedis(): Promise<void> {
  if (redisClient?.isOpen) {
    await redisClient.quit()
  }

  redisClient = undefined
  connectPromise = undefined
}
