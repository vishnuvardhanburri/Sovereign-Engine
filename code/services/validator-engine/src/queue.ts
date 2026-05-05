import { Queue } from 'bullmq'
import { validatorEnv } from './config'

export const VALIDATION_QUEUE_HIGH = 'xv-email-validation-hp'
export const VALIDATION_QUEUE_BULK = 'xv-email-validation-bulk'
export const DOMAIN_AUTH_QUEUE = 'xv-domain-auth-enrich'

export function createQueue(name: string) {
  return new Queue(name, {
    connection: { url: validatorEnv.redisUrl() },
    defaultJobOptions: {
      attempts: 4,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: 5000,
      removeOnFail: 20000,
    },
  })
}
