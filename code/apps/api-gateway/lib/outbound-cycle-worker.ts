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
  // Next can serialize the incoming origin as https://0.0.0.0:$PORT, which
  // breaks because the local listener is HTTP. Preserve path/query only and
  // always call the local listener unless explicitly overridden.
  const internalBase = process.env.OUTBOUND_CYCLE_INTERNAL_BASE || `http://127.0.0.1:${process.env.PORT || '10000'}`
  return new URL(`${url.pathname}${url.search}`, internalBase).toString()
}

async function fetchCycleRunUrl(input: {
  runUrl: string
  publicRunUrl: string
  secret: string
  signal: AbortSignal
}): Promise<{
  response: Response
  body: string
  usedPublicFallback: boolean
}> {
  const headers = {
    'user-agent': 'Sovereign-Engine-Outbound-Cycle-Worker/1.0',
    ...(input.secret ? { 'x-cron-secret': input.secret } : {}),
  }

  try {
    const response = await fetch(input.runUrl, {
      method: 'GET',
      headers,
      cache: 'no-store',
      signal: input.signal,
    })
    return {
      response,
      body: await response.text(),
      usedPublicFallback: false,
    }
  } catch (localError) {
    if (input.runUrl === input.publicRunUrl) throw localError

    console.warn('[outbound-cycle-worker] local cycle fetch failed; retrying public origin', {
      error: localError instanceof Error ? localError.message : String(localError),
    })

    const response = await fetch(input.publicRunUrl, {
      method: 'GET',
      headers,
      cache: 'no-store',
      signal: input.signal,
    })
    return {
      response,
      body: await response.text(),
      usedPublicFallback: true,
    }
  }
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
    const result = await fetchCycleRunUrl({
      runUrl,
      publicRunUrl: job.data.runUrl,
      secret,
      signal: controller.signal,
    })
    response = result.response
    body = result.body
    elapsedMs = Date.now() - startedAt
    if (result.usedPublicFallback) {
      console.warn('[outbound-cycle-worker] cycle completed through public fallback', {
        jobId: job.id,
        clientId: job.data.clientId,
        status: response.status,
        elapsedMs,
      })
    }
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
