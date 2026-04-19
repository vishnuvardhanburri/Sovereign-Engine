import { enqueueQueueJobs } from '@/lib/redis'

export interface RetryResult {
  retried: boolean
  nextAttemptAt?: string
  reason?: string
}

export async function retryFailedJob(input: {
  jobId: number
  clientId: number
  attempts: number
  maxAttempts: number
}): Promise<RetryResult> {
  if (input.attempts >= input.maxAttempts) {
    return {
      retried: false,
      reason: 'max retries exceeded',
    }
  }

  const backoffMinutes = Math.pow(2, input.attempts)
  const nextAttemptAt = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString()

  await enqueueQueueJobs([
    {
      id: Date.now() + input.jobId,
      client_id: input.clientId,
      contact_id: 0,
      campaign_id: 0,
      sequence_step: 1,
      scheduled_at: nextAttemptAt,
    },
  ])

  return {
    retried: true,
    nextAttemptAt,
  }
}
