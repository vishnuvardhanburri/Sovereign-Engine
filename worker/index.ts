import 'dotenv/config'
import * as backendModule from '../lib/backend'
import * as dbModule from '../lib/db'
import * as redisModule from '../lib/redis'
import * as envModule from '../lib/env'
import { evaluateQueueDecision } from '../lib/agents/execution/decision-agent'
import { loadBackendAgentPrompt } from '../lib/agents/agent-prompt'
import { sendMessage } from '../lib/agents/execution/sender-agent'

const appEnv =
  (envModule as any).appEnv ?? (envModule as any).default?.appEnv
const validateWorkerEnv =
  (envModule as any).validateWorkerEnv ?? (envModule as any).default?.validateWorkerEnv

if (typeof validateWorkerEnv !== 'function' || !appEnv) {
  throw new Error('Failed to load env module exports for worker runtime')
}

validateWorkerEnv()

const backend = ((backendModule as any).default ?? backendModule) as any
const db = ((dbModule as any).default ?? dbModule) as any
const redis = ((redisModule as any).default ?? redisModule) as any

const claimQueueJob = backend.claimQueueJob as typeof import('../lib/backend.ts').claimQueueJob
const deferQueueJob = backend.deferQueueJob as typeof import('../lib/backend.ts').deferQueueJob
const loadQueueExecutionContext = backend.loadQueueExecutionContext as typeof import('../lib/backend.ts').loadQueueExecutionContext
const markQueueJobCompleted = backend.markQueueJobCompleted as typeof import('../lib/backend.ts').markQueueJobCompleted
const markQueueJobFailed = backend.markQueueJobFailed as typeof import('../lib/backend.ts').markQueueJobFailed
const markQueueJobSkipped = backend.markQueueJobSkipped as typeof import('../lib/backend.ts').markQueueJobSkipped
const popQueuedJob = backend.popQueuedJob as typeof import('../lib/backend.ts').popQueuedJob
const promoteReadyQueueJobs = backend.promoteReadyQueueJobs as typeof import('../lib/backend.ts').promoteReadyQueueJobs

const closePool = db.closePool as typeof import('../lib/db.ts').closePool
const closeRedis = redis.closeRedis as typeof import('../lib/redis.ts').closeRedis

const backendAgentPrompt = loadBackendAgentPrompt()

let shuttingDown = false

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function processOnce() {
  await promoteReadyQueueJobs()
  const queued = await popQueuedJob()

  if (!queued) {
    await sleep(appEnv.workerIdleSleepMs())
    return
  }

  const claimed = await claimQueueJob(queued.id, queued.client_id)
  if (!claimed) {
    return
  }

  const context = await loadQueueExecutionContext(claimed.client_id, claimed.id)
  if (!context) {
    return
  }

  const decision = await evaluateQueueDecision(context, backendAgentPrompt)

  if (decision.action === 'skip') {
    await markQueueJobSkipped(context, decision.reason)
    return
  }

  if (decision.action === 'defer') {
    await deferQueueJob(context, decision.scheduledAt, decision.reason)
    return
  }

  if (decision.action === 'send') {
    try {
      const response = await sendMessage({
        fromEmail: `Xavira Orbit <${decision.selection.identity.email}>`,
        toEmail: context.job.recipient_email || context.contact.email,
        cc: context.job.cc_emails ?? undefined,
        subject: decision.message.subject,
        html: decision.message.html,
        text: decision.message.text,
        headers: {
          'X-Campaign-Id': String(context.campaign.id),
          'X-Queue-Job-Id': String(context.job.id),
          'List-Unsubscribe': `<${decision.message.unsubscribeUrl}>`,
        },
      })

      if (!response.success) {
        await markQueueJobFailed(context, response.error ?? 'smtp send failed')
        console.error(
          `[Worker] smtp error queue_job=${context.job.id} to=${context.contact.email}: ${response.error}`
        )
        return
      }

      await markQueueJobCompleted(context, decision.selection, response.providerMessageId ?? null)
      console.log(
        `[Worker] sent queue_job=${context.job.id} to=${context.contact.email} identity=${decision.selection.identity.email}`
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'unknown worker send failure'
      await markQueueJobFailed(context, message)
      console.error(`[Worker] failed queue_job=${context.job.id}:`, error)
    }
  }
}

async function main() {
  console.log('[Worker] starting Xavira Orbit worker')
  console.log('[Worker] loaded backend agent prompt', {
    length: backendAgentPrompt.length,
  })

  while (!shuttingDown) {
    try {
      await processOnce()
      await sleep(appEnv.workerPollIntervalMs())
    } catch (error) {
      console.error('[Worker] loop error', error)
      await sleep(appEnv.workerIdleSleepMs())
    }
  }
}

async function shutdown(signal: string) {
  shuttingDown = true
  console.log(`[Worker] shutting down on ${signal}`)
  await Promise.allSettled([closeRedis(), closePool()])
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

void main()
