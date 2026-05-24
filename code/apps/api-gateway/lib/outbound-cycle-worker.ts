import crypto from 'node:crypto'
import { Queue, Worker, type Job } from 'bullmq'
import { appEnv } from '@/lib/env'

type OutboundCycleJobData = {
  clientId: number
  runUrl: string
  createdAt: string
}

const OUTBOUND_CYCLE_QUEUE = process.env.OUTBOUND_CYCLE_QUEUE ?? 'xv-outbound-cycle'
const OUTBOUND_CYCLE_WORKER_CONCURRENCY = Math.max(
  1,
  Math.min(Number.parseInt(process.env.OUTBOUND_CYCLE_WORKER_CONCURRENCY ?? '1', 10) || 1, 3)
)

let cycleWorker: Worker<OutboundCycleJobData> | null = null

function hourlyJobId(clientId: number, runUrl: string): string {
  const hourBucket = new Date().toISOString().slice(0, 13)
  const hash = crypto
    .createHash('sha256')
    .update(`${clientId}:${hourBucket}:${runUrl}`)
    .digest('hex')
    .slice(0, 20)

  return `daily-outbound:${clientId}:${hourBucket}:${hash}`
}

export async function enqueueOutboundCycleJob(input: {
  clientId: number
  runUrl: string
}): Promise<{ queue: string; jobId: string | undefined; dedupeKey: string }> {
  const queue = new Queue<OutboundCycleJobData>(OUTBOUND_CYCLE_QUEUE, {
    connection: { url: appEnv.redisUrl() },
  })
  const dedupeKey = hourlyJobId(input.clientId, input.runUrl)

  try {
    const job = await queue.add(
      'daily_outbound_cycle',
      {
        clientId: input.clientId,
        runUrl: input.runUrl,
        createdAt: new Date().toISOString(),
      },
      {
        jobId: dedupeKey,
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 60_000,
        },
        removeOnComplete: 200,
        removeOnFail: 200,
      }
    )

    return {
      queue: OUTBOUND_CYCLE_QUEUE,
      jobId: job.id === undefined ? undefined : String(job.id),
      dedupeKey,
    }
  } finally {
    await queue.close()
  }
}

async function processOutboundCycle(job: Job<OutboundCycleJobData>) {
  const secret = appEnv.cronSecret()
  const startedAt = Date.now()

  console.log('[outbound-cycle-worker] cycle started', {
    jobId: job.id,
    clientId: job.data.clientId,
  })

  const response = await fetch(job.data.runUrl, {
    method: 'GET',
    headers: {
      'user-agent': 'Sovereign-Engine-Outbound-Cycle-Worker/1.0',
      ...(secret ? { 'x-cron-secret': secret } : {}),
    },
    cache: 'no-store',
  })
  const body = await response.text()
  const elapsedMs = Date.now() - startedAt

  if (!response.ok) {
    throw new Error(`daily_outbound_cycle_http_${response.status}:${body.slice(0, 240)}`)
  }

  console.log('[outbound-cycle-worker] cycle completed', {
    jobId: job.id,
    clientId: job.data.clientId,
    status: response.status,
    elapsedMs,
    body: body.slice(0, 300),
  })

  return {
    status: response.status,
    elapsedMs,
  }
}

export function startOutboundCycleWorker(): { queue: string; started: boolean } {
  if (cycleWorker) {
    return { queue: OUTBOUND_CYCLE_QUEUE, started: false }
  }

  cycleWorker = new Worker<OutboundCycleJobData>(OUTBOUND_CYCLE_QUEUE, processOutboundCycle, {
    connection: { url: appEnv.redisUrl() },
    concurrency: OUTBOUND_CYCLE_WORKER_CONCURRENCY,
  })

  cycleWorker.on('failed', (job, error) => {
    console.error('[outbound-cycle-worker] cycle failed', {
      jobId: job?.id,
      clientId: job?.data?.clientId,
      error: error instanceof Error ? error.message : String(error),
    })
  })

  cycleWorker.on('error', (error) => {
    console.error('[outbound-cycle-worker] worker error', error)
  })

  console.log('[outbound-cycle-worker] worker started', {
    queue: OUTBOUND_CYCLE_QUEUE,
    concurrency: OUTBOUND_CYCLE_WORKER_CONCURRENCY,
  })

  return { queue: OUTBOUND_CYCLE_QUEUE, started: true }
}
