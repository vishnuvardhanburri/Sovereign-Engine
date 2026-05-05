import { Queue, type QueueOptions, type JobsOptions } from 'bullmq'

export function createQueue(
  name: string,
  opts: { redisUrl: string; defaultJobOptions?: JobsOptions; queueOptions?: Omit<QueueOptions, 'connection' | 'defaultJobOptions'> }
) {
  return new Queue(name, {
    connection: { url: opts.redisUrl },
    defaultJobOptions: {
      attempts: 4,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: 5000,
      removeOnFail: 20000,
      ...(opts.defaultJobOptions ?? {}),
    },
    ...(opts.queueOptions ?? {}),
  })
}

