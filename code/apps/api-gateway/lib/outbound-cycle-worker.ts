import { Worker, type Job } from 'bullmq'
import { appEnv } from '@/lib/env'
import { OUTBOUND_CYCLE_QUEUE, type OutboundCycleJobData } from '@/lib/outbound-cycle-queue'

const OUTBOUND_CYCLE_WORKER_CONCURRENCY = Math.max(
  1,
  Math.min(Number.parseInt(process.env.OUTBOUND_CYCLE_WORKER_CONCURRENCY ?? '1', 10) || 1, 3)
)
const OUTBOUND_CYCLE_TIMEOUT_MS = Math.max(
  15_000,
  Math.min(Number.parseInt(process.env.OUTBOUND_CYCLE_TIMEOUT_MS ?? '120000', 10) || 120_000, 300_000)
)

let cycleWorker: Worker<OutboundCycleJobData> | null = null

async function processOutboundCycle(job: Job<OutboundCycleJobData>) {
  const secret = appEnv.cronSecret()
  const startedAt = Date.now()

  console.log('[outbound-cycle-worker] cycle started', {
    jobId: job.id,
    clientId: job.data.clientId,
  })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), OUTBOUND_CYCLE_TIMEOUT_MS)
  let response: Response
  let body = ''
  let elapsedMs = 0

  try {
    response = await fetch(job.data.runUrl, {
      method: 'GET',
      headers: {
        'user-agent': 'Sovereign-Engine-Outbound-Cycle-Worker/1.0',
        ...(secret ? { 'x-cron-secret': secret } : {}),
      },
      cache: 'no-store',
      signal: controller.signal,
    })
    body = await response.text()
    elapsedMs = Date.now() - startedAt
  } catch (error) {
    elapsedMs = Date.now() - startedAt
    if ((error as any)?.name === 'AbortError') {
      throw new Error(`daily_outbound_cycle_timeout:${OUTBOUND_CYCLE_TIMEOUT_MS}`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }

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
