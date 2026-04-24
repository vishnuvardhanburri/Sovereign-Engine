// @ts-nocheck
import 'dotenv/config'
import * as backendModule from '../lib/backend'
import * as dbModule from '../lib/db'
import * as redisModule from '../lib/redis'
import * as envModule from '../lib/env'
import * as decisionAgentModule from '../lib/agents/execution/decision-agent'
import * as agentPromptModule from '../lib/agents/agent-prompt'
import * as senderAgentModule from '../lib/agents/execution/sender-agent'
import * as controlLoopModule from '../lib/control-loop-enforcer'
import * as productionFixesModule from '../lib/production-fixes'
import * as coordinatorModule from '../lib/infrastructure/coordinator'
import * as sendSafeModule from '../lib/delivery/send-safe'

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
const decisionAgent = ((decisionAgentModule as any).default ?? decisionAgentModule) as any
const agentPrompt = ((agentPromptModule as any).default ?? agentPromptModule) as any
const senderAgent = ((senderAgentModule as any).default ?? senderAgentModule) as any
const controlLoop = ((controlLoopModule as any).default ?? controlLoopModule) as any
const productionFixes = ((productionFixesModule as any).default ?? productionFixesModule) as any
const sendSafeLib = ((sendSafeModule as any).default ?? sendSafeModule) as any
const coordinator = (coordinatorModule as any).coordinator ?? (coordinatorModule as any).default?.coordinator ?? (coordinatorModule as any).default

const circuitBreaker = productionFixes.circuitBreaker as typeof import('../lib/production-fixes.ts').circuitBreaker
const recordMetric = productionFixes.recordMetric as typeof import('../lib/production-fixes.ts').recordMetric
const StructuredLogger = productionFixes.StructuredLogger as typeof import('../lib/production-fixes.ts').StructuredLogger

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
const ackProcessingJob = redis.ackProcessingJob as typeof import('../lib/redis.ts').ackProcessingJob
const reclaimExpiredJobs = redis.reclaimExpiredJobs as typeof import('../lib/redis.ts').reclaimExpiredJobs

const evaluateQueueDecision = decisionAgent.evaluateQueueDecision as any
const loadBackendAgentPrompt = agentPrompt.loadBackendAgentPrompt as any
const sendMessage = senderAgent.sendMessage as any
const executeControlLoop = controlLoop.executeControlLoop as any
const sendSafe = sendSafeLib.sendSafe as any

const backendAgentPrompt = loadBackendAgentPrompt()
const logger = new StructuredLogger('worker')

let shuttingDown = false
let infrastructureHealthy = true
let errorStreak = 0

process.on('unhandledRejection', (reason) => {
  logger.log('error', 'Unhandled promise rejection', { reason: String(reason) })
})
process.on('uncaughtException', (err) => {
  logger.log('error', 'Uncaught exception', { error: err?.message ?? String(err) })
})

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Get email queue for campaign (for control loop enforcer)
 */
async function getEmailQueueForCampaign(campaignId: string | number): Promise<any[]> {
  try {
    const result = await db.query(`
      SELECT id, recipient_email as "to", subject, body, campaign_id, contact_id
      FROM emails
      WHERE campaign_id = $1 AND status = 'pending'
      ORDER BY created_at ASC
    `, [campaignId])

    return result.rows.map(row => ({
      id: row.id,
      to: row.to,
      subject: row.subject,
      body: row.body,
      campaign_id: row.campaign_id,
      contact_id: row.contact_id,
    }))
  } catch (error) {
    console.error('[Worker] Failed to get email queue:', error)
    return []
  }
}

/**
 * Monitor infrastructure in background
 */
async function monitorInfrastructure() {
  setInterval(async () => {
    try {
      const state = await coordinator.getState()

      // Check critical conditions
      if (state.capacityUtilization > 90) {
        console.warn('[Worker] ALERT: Capacity utilization > 90%')
        infrastructureHealthy = false
      }

      // Check if system is paused
      if (state.isPaused) {
        console.warn('[Worker] WARNING: Infrastructure system is PAUSED')
        infrastructureHealthy = false
      }

      // Check health issues
      if (!state.systemHealth.isHealthy) {
        console.warn('[Worker] System has issues:', state.systemHealth.issues)
        infrastructureHealthy = false
      }

      // Reset healthy if issues resolved
      if (
        state.capacityUtilization < 85 &&
        !state.isPaused &&
        state.systemHealth.isHealthy
      ) {
        infrastructureHealthy = true
      }
    } catch (error) {
      console.error('[Worker] Infrastructure monitoring error:', error)
    }
  }, 30000) // Check every 30 seconds
}

async function processOnce() {
  await promoteReadyQueueJobs()
  await reclaimExpiredJobs(250)
  const queued = await popQueuedJob()

  if (!queued) {
    await sleep(appEnv.workerIdleSleepMs())
    return
  }

  const claimed = await claimQueueJob(queued.id, queued.client_id)
  if (!claimed) {
    if (queued._raw) {
      await ackProcessingJob(queued._raw)
    }
    return
  }

  const context = await loadQueueExecutionContext(claimed.client_id, claimed.id)
  if (!context) {
    if (queued._raw) {
      await ackProcessingJob(queued._raw)
    }
    return
  }

  const decision = await evaluateQueueDecision(context, backendAgentPrompt)

  // SPECIAL: Handle control loop enforcer jobs
  if (context.job.type === 'control_loop_enforcer') {
    try {
      console.log(`[Worker] Executing control loop enforcer for job ${context.job.id}`)

      // Get target from job metadata
      const target = context.job.metadata?.target || 50000

      // Get email queue for this campaign
      const emailQueue = await getEmailQueueForCampaign(context.campaign.id)

      if (emailQueue.length === 0) {
        await markQueueJobSkipped(context, 'No emails in queue for control loop')
        return
      }

      // Execute control loop enforcer
      const result = await executeControlLoop(emailQueue, target)

      // Mark job as completed with result
      await markQueueJobCompleted(context, null, JSON.stringify(result))
      if (queued._raw) {
        await ackProcessingJob(queued._raw)
      }

      console.log(`[Worker] Control loop completed: ${result.sent}/${result.target} emails sent`)

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Control loop enforcer failed'
      await markQueueJobFailed(context, message)
      console.error(`[Worker] Control loop error:`, error)
      if (queued._raw) {
        await ackProcessingJob(queued._raw)
      }
    }
    return
  }

  if (decision.action === 'skip') {
    await markQueueJobSkipped(context, decision.reason)
    if (queued._raw) {
      await ackProcessingJob(queued._raw)
    }
    return
  }

  if (decision.action === 'defer') {
    await deferQueueJob(context, decision.scheduledAt, decision.reason)
    if (queued._raw) {
      await ackProcessingJob(queued._raw)
    }
    return
  }

  if (decision.action === 'send') {
    try {
      // Check infrastructure health before sending
      if (!infrastructureHealthy) {
        const state = await coordinator.getState()
        if (state.isPaused) {
          // Defer job if system is paused
          await deferQueueJob(
            context,
            new Date(Date.now() + 5 * 60 * 1000),
            'Infrastructure paused for maintenance'
          )
          return
        }
      }

      const result = await sendSafe({
        context,
        selection: decision.selection,
        message: decision.message,
        deps: {
          coordinatorSend: coordinator.send.bind(coordinator),
          smtpSend: async (req: any) =>
            sendMessage({
              fromEmail: req.fromEmail,
              toEmail: req.toEmail,
              cc: req.cc,
              subject: req.subject,
              html: req.html,
              text: req.text,
              headers: req.headers,
            }),
        },
      })

      if (!result.ok) {
        errorStreak++
        logger.log('error', 'sendSafe failed', { error: result.error, errorStreak })
        await recordMetric(context.campaign.id, 'send_safe_failed', 1)
        // Slow down on errors (in addition to job-level exponential backoff).
        await sleep(Math.min(30_000, 2_000 * errorStreak))
        if (queued._raw) await ackProcessingJob(queued._raw)
        return
      }

      if (result.action === 'skipped' || result.action === 'deferred') {
        errorStreak = 0
        if (queued._raw) await ackProcessingJob(queued._raw)
        return
      }

      await markQueueJobCompleted(context, decision.selection, result.providerMessageId ?? null)
      if (queued._raw) {
        await ackProcessingJob(queued._raw)
      }
      errorStreak = 0
      console.log(`[Worker] sent queue_job=${context.job.id} to=${context.contact.email}`)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'unknown worker send failure'
      errorStreak++
      await markQueueJobFailed(context, message)
      console.error(`[Worker] failed queue_job=${context.job.id}:`, error)
      if (queued._raw) {
        await ackProcessingJob(queued._raw)
      }
      // Slow down on unexpected exceptions.
      await sleep(Math.min(30_000, 2_000 * errorStreak))
    }
  }
}

async function main() {
  console.log('[Worker] starting Xavira Orbit worker with autonomous infrastructure')
  console.log('[Worker] loaded backend agent prompt', {
    length: backendAgentPrompt.length,
  })

  // Initialize coordinator
  await coordinator.initialize()
  console.log('[Worker] autonomous infrastructure initialized')

  // Start infrastructure monitoring
  monitorInfrastructure()
  console.log('[Worker] infrastructure monitoring started')

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
