import { enqueueQueueJobs } from '@/lib/redis'

export interface OutboundJobPayload {
  clientId: number
  campaignId: number
  domainId: number
  contactId: number
  contactEmail: string
  subject: string
  body: string
  sequenceStep: 'step_1' | 'step_2' | 'step_3'
  scheduledAt: string
  attempts?: number
  maxAttempts?: number
}

export async function enqueueOutboundJobs(jobs: OutboundJobPayload[]): Promise<{ enqueued: number }> {
  const payloads = jobs.map((job) => ({
    jobId: Date.now() + Math.floor(Math.random() * 1000),
    clientId: job.clientId,
    campaignId: job.campaignId,
    domainId: job.domainId,
    contactId: job.contactId,
    contactEmail: job.contactEmail,
    subject: job.subject,
    body: job.body,
    sequenceStep: job.sequenceStep,
    scheduledAt: job.scheduledAt,
    attempts: job.attempts ?? 0,
    maxAttempts: job.maxAttempts ?? 3,
  }))

  await enqueueQueueJobs(payloads)

  return { enqueued: payloads.length }
}
