// @ts-nocheck
import 'dotenv/config'
import * as backendModule from '../lib/backend'
import * as dbModule from '../lib/db'
import * as redisModule from '../lib/redis'
import * as envModule from '../lib/env'
import { evaluateQueueDecision } from '../lib/agents/execution/decision-agent'
import { loadBackendAgentPrompt } from '../lib/agents/agent-prompt'
import { sendMessage } from '../lib/agents/execution/sender-agent'
import { executeControlLoop, ControlLoopEnforcer } from '../lib/control-loop-enforcer'
import { generateIdempotencyKey, circuitBreaker, recordMetric, StructuredLogger } from '../lib/production-fixes'

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
let infrastructureHealthy = true

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

      console.log(`[Worker] Control loop completed: ${result.sent}/${result.target} emails sent`)

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Control loop enforcer failed'
      await markQueueJobFailed(context, message)
      console.error(`[Worker] Control loop error:`, error)
    }
    return
  }

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

      // Use coordinator for sending (intelligent routing + failover)
      const coordResult = await coordinator.send({
        campaignId: String(context.campaign.id),
        to: context.job.recipient_email || context.contact.email,
        from: `Xavira Orbit <${decision.selection.identity.email}>`,
        subject: decision.message.subject,
        html: decision.message.html,
        text: decision.message.text,
        metadata: {
          queueJobId: String(context.job.id),
          contactId: String(context.contact.id),
          campaignId: String(context.campaign.id),
          sequenceId: context.job.sequence_id ? String(context.job.sequence_id) : undefined,
          unsubscribeUrl: decision.message.unsubscribeUrl,
        },
      })

      if (!coordResult.success) {
        // PRODUCTION FIX: Track circuit breaker failure
        await circuitBreaker.recordFailure(String(decision.selection.identity.id), 'identity')
        await circuitBreaker.recordFailure(String(decision.selection.domain.id), 'domain')
        await markQueueJobFailed(context, coordResult.error || 'Coordinator send failed')
        logger.log('error', 'Coordinator send failed', { error: coordResult.error })
        await recordMetric(context.campaign.id, 'send_coordinator_failed', 1)
        return
      }

      // Use traditional SMTP send as backup
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
          'X-Coordinator-Inbox': coordResult.inboxUsed || 'unknown',
          'X-Coordinator-Domain': coordResult.domainUsed || 'unknown',
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
        `[Worker] sent queue_job=${context.job.id} to=${context.contact.email} inbox=${coordResult.inboxUsed} domain=${coordResult.domainUsed}`
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
