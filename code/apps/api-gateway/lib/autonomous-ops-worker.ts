import { Worker, type Job } from 'bullmq'
import { appEnv } from '@/lib/env'
import { query } from '@/lib/db'
import { withDistributedLock } from '@/lib/distributed-lock'
import { recordConversationIntelligence } from '@/lib/conversation-intelligence'
import { syncRecentContactsToCrm } from '@/lib/crm/sync-service'
import { markSourceConnectionFailure, runSourceConnection } from '@/lib/ingestion/source-runner'
import { runAutonomousOutboundDecisions } from '@/lib/orchestration/autonomous-orchestrator'
import { appendOperationalEvent } from '@/lib/operational-events'
import { collectOperationalTelemetry, recordWorkerHeartbeat } from '@/lib/observability/autonomous-telemetry'
import { allAutonomousQueues, queueName } from '@/lib/queue/autonomous-queue-topology'
import type { AutonomousJobData } from '@/lib/queue/autonomous-queue-client'

const OPS_WORKER_CONCURRENCY = Math.max(1, Math.min(Number(process.env.AUTONOMOUS_OPS_CONCURRENCY ?? 1), 4))
const workers: Worker<AutonomousJobData>[] = []

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function recordDeadLetter(job: Job<AutonomousJobData> | undefined, error: Error, queue: string) {
  if (!job?.data?.clientId) return
  await query(
    `INSERT INTO dead_letter_events (
       client_id,
       queue_name,
       job_id,
       job_name,
       attempts_made,
       error_message,
       payload
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [
      job.data.clientId,
      queue,
      String(job.id ?? ''),
      job.name,
      job.attemptsMade,
      error.message.slice(0, 1000),
      JSON.stringify(job.data),
    ]
  ).catch(() => undefined)
  await appendOperationalEvent({
    clientId: job.data.clientId,
    eventType: 'queue.dead_letter',
    aggregateType: 'queue_job',
    aggregateId: job.id ?? `${queue}:unknown`,
    actorType: 'worker',
    payload: {
      queue,
      kind: job.data.kind,
      attemptsMade: job.attemptsMade,
      error: error.message.slice(0, 500),
    },
  }).catch(() => undefined)
}

async function handleJob(job: Job<AutonomousJobData>) {
  const data = job.data
  await recordWorkerHeartbeat({
    clientId: data.clientId,
    workerName: 'autonomous-ops-worker',
    queueName: job.queueName,
    status: 'healthy',
    metrics: { jobId: job.id, kind: data.kind },
  })

  if (data.kind === 'ingestion.pull') {
    if (!data.sourceConnectionId) throw new Error('ingestion_pull_missing_source_connection_id')
    return withDistributedLock(`ingestion:${data.clientId}:${data.sourceConnectionId}`, 120_000, async () => {
      try {
        return await runSourceConnection({
          clientId: data.clientId,
          sourceConnectionId: data.sourceConnectionId!,
          limit: data.limit,
          requestedBy: data.requestedBy ?? 'autonomous_ops_worker',
        })
      } catch (error) {
        await markSourceConnectionFailure({
          clientId: data.clientId,
          sourceConnectionId: data.sourceConnectionId!,
          error: errorMessage(error),
        })
        throw error
      }
    })
  }

  if (data.kind === 'enrichment.score' || data.kind === 'orchestration.rebalance') {
    return withDistributedLock(`orchestration:${data.clientId}`, 90_000, () =>
      runAutonomousOutboundDecisions({ clientId: data.clientId, limit: data.limit ?? 200 })
    )
  }

  if (data.kind === 'conversation.classify') {
    const payload = data.payload ?? {}
    const fromEmail = String(payload.fromEmail ?? payload.from_email ?? '')
    if (!fromEmail) throw new Error('conversation_missing_from_email')
    return recordConversationIntelligence({
      clientId: data.clientId,
      fromEmail,
      subject: String(payload.subject ?? ''),
      body: String(payload.body ?? ''),
      messageId: payload.messageId ? String(payload.messageId) : undefined,
    })
  }

  if (data.kind === 'crm.sync') {
    const provider = String(data.payload?.provider ?? 'hubspot')
    if (provider !== 'hubspot' && provider !== 'salesforce') {
      throw new Error(`crm_provider_not_supported:${provider}`)
    }
    return syncRecentContactsToCrm({
      clientId: data.clientId,
      provider,
      limit: data.limit,
    })
  }

  if (data.kind === 'telemetry.sample') {
    return collectOperationalTelemetry(data.clientId)
  }

  if (data.kind === 'workflow.execute') {
    await appendOperationalEvent({
      clientId: data.clientId,
      eventType: 'workflow.execution_requested',
      aggregateType: 'workflow',
      aggregateId: data.workflowId ?? 'adhoc',
      actorType: 'worker',
      payload: data.payload ?? {},
    })
    return { queued: true }
  }

  throw new Error(`unsupported_autonomous_job:${data.kind}`)
}

export function startAutonomousOpsWorker() {
  if (workers.length) return { started: false, queues: workers.map((worker) => worker.name) }

  for (const { name, queue } of allAutonomousQueues().filter((entry) =>
    ['ingestion', 'enrichment', 'decision', 'conversation', 'workflow', 'telemetry'].includes(entry.name)
  )) {
    const worker = new Worker<AutonomousJobData>(queue, handleJob, {
      connection: { url: appEnv.redisUrl() },
      concurrency: OPS_WORKER_CONCURRENCY,
    })

    worker.on('failed', (job, error) => {
      console.error('[autonomous-ops-worker] job failed', {
        queue,
        jobId: job?.id,
        kind: job?.data?.kind,
        error: error.message,
      })
      void recordDeadLetter(job, error, queue)
    })

    worker.on('error', (error) => {
      console.error('[autonomous-ops-worker] worker error', { queue, error: error.message })
    })

    workers.push(worker)
    void recordWorkerHeartbeat({
      workerName: 'autonomous-ops-worker',
      queueName: queueName(name),
      status: 'starting',
      metrics: { concurrency: OPS_WORKER_CONCURRENCY },
    }).catch(() => undefined)
  }

  console.log('[autonomous-ops-worker] started', {
    queues: workers.map((worker) => worker.name),
    concurrency: OPS_WORKER_CONCURRENCY,
  })

  return { started: true, queues: workers.map((worker) => worker.name) }
}
