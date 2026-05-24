import crypto from 'node:crypto'
import { Queue } from 'bullmq'
import { appEnv } from '@/lib/env'

export type OutboundCycleJobData = {
  clientId: number
  runUrl: string
  createdAt: string
}

export const OUTBOUND_CYCLE_QUEUE = process.env.OUTBOUND_CYCLE_QUEUE ?? 'xv-outbound-cycle'

function hourlyJobId(clientId: number, runUrl: string): string {
  const hourBucket = new Date().toISOString().slice(0, 13)
  const hash = crypto
    .createHash('sha256')
    .update(`${clientId}:${hourBucket}:${runUrl}`)
    .digest('hex')
    .slice(0, 20)

  return `daily-outbound-${clientId}-${hourBucket}-${hash}`
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
