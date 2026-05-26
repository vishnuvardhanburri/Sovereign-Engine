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

function localRunUrl(rawUrl: string): string {
  const url = new URL(rawUrl)
  const forcePublicFetch = String(process.env.OUTBOUND_CYCLE_PUBLIC_FETCH ?? '').toLowerCase() === 'true'
  if (forcePublicFetch) return url.toString()

  // The cycle worker runs inside the same Render web service as Next.js.
  // Fetching the public onrender.com hostname from inside that container can
  // fail or bounce through the edge. Use the local listener for reliability.
  if (url.hostname.endsWith('.onrender.com') || url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    const port = process.env.PORT || '10000'
    url.protocol = 'http:'
    url.hostname = '127.0.0.1'
    url.port = port
  }

  return url.toString()
}

async function processOutboundCycle(job: Job<OutboundCycleJobData>) {
  const secret = appEnv.cronSecret()
  const startedAt = Date.now()
  const runUrl = localRunUrl(job.data.runUrl)

  console.log('[outbound-cycle-worker] cycle started', {
    jobId: job.id,
    clientId: job.data.clientId,
    localFetch: runUrl !== job.data.runUrl,
  })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), OUTBOUND_CYCLE_TIMEOUT_MS)
  let response: Response
  let body = ''
  let elapsedMs = 0

  try {
    response = await fetch(runUrl, {
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
