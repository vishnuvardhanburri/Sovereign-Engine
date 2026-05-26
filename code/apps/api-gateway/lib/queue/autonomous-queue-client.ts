import { Queue, type JobsOptions } from 'bullmq'
import { appEnv } from '@/lib/env'
import {
  AUTONOMOUS_QUEUE_TOPOLOGY,
  type AutonomousQueueName,
  allAutonomousQueues,
  queueName,
} from '@/lib/queue/autonomous-queue-topology'
import { stableHash } from '@/lib/operational-events'

export type AutonomousJobKind =
  | 'ingestion.pull'
  | 'enrichment.score'
  | 'orchestration.rebalance'
  | 'conversation.classify'
  | 'crm.sync'
  | 'workflow.execute'
  | 'telemetry.sample'

export interface AutonomousJobData {
  clientId: number
  kind: AutonomousJobKind
  sourceConnectionId?: string
  contactId?: number
  conversationId?: string
  workflowId?: string
  provider?: string
  lane?: string
  limit?: number
  payload?: Record<string, unknown>
  requestedBy?: string
}

const queues = new Map<AutonomousQueueName, Queue<AutonomousJobData>>()

function defaultJobOptions(): JobsOptions {
  return {
    attempts: 4,
    backoff: { type: 'exponential', delay: 15_000 },
    removeOnComplete: { age: 60 * 60 * 24, count: 2000 },
    removeOnFail: { age: 60 * 60 * 24 * 7, count: 5000 },
  }
}

export function getAutonomousQueue(name: AutonomousQueueName): Queue<AutonomousJobData> {
  const existing = queues.get(name)
  if (existing) return existing
  const queue = new Queue<AutonomousJobData>(queueName(name), {
    connection: { url: appEnv.redisUrl() },
    defaultJobOptions: defaultJobOptions(),
  })
  queues.set(name, queue)
  return queue
}

export function queueForKind(kind: AutonomousJobKind): AutonomousQueueName {
  if (kind.startsWith('ingestion.')) return 'ingestion'
  if (kind.startsWith('enrichment.')) return 'enrichment'
  if (kind.startsWith('orchestration.')) return 'decision'
  if (kind.startsWith('conversation.')) return 'conversation'
  if (kind.startsWith('crm.')) return 'workflow'
  if (kind.startsWith('workflow.')) return 'workflow'
  if (kind.startsWith('telemetry.')) return 'telemetry'
  return 'workflow'
}

export async function enqueueAutonomousJob(data: AutonomousJobData, options: JobsOptions = {}) {
  const queueKey = queueForKind(data.kind)
  const queue = getAutonomousQueue(queueKey)
  const jobId =
    options.jobId ??
    stableHash({
      clientId: data.clientId,
      kind: data.kind,
      sourceConnectionId: data.sourceConnectionId,
      contactId: data.contactId,
      conversationId: data.conversationId,
      workflowId: data.workflowId,
      provider: data.provider,
      lane: data.lane,
      payload: data.payload ?? {},
    })
  return queue.add(data.kind, data, { ...options, jobId })
}

export async function getAutonomousQueueCounts() {
  const entries = await Promise.all(
    allAutonomousQueues().map(async ({ name, queue }) => {
      const q = getAutonomousQueue(name)
      const counts = await q.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed')
      return [name, { queue, ...counts }] as const
    })
  )
  return Object.fromEntries(entries) as Record<
    AutonomousQueueName,
    { queue: string; waiting: number; active: number; delayed: number; failed: number; completed: number }
  >
}

export { AUTONOMOUS_QUEUE_TOPOLOGY }
