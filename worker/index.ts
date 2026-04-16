import 'dotenv/config'
import { Resend } from 'resend'
import * as backendModule from '../lib/backend.ts'
import * as dbModule from '../lib/db.ts'
import * as redisModule from '../lib/redis.ts'
import * as envModule from '../lib/env.ts'

const appEnv =
  (envModule as any).appEnv ?? (envModule as any).default?.appEnv
const validateWorkerEnv =
  (envModule as any).validateWorkerEnv ?? (envModule as any).default?.validateWorkerEnv

if (typeof validateWorkerEnv !== 'function' || !appEnv) {
  throw new Error('Failed to load env module exports for worker runtime')
}

validateWorkerEnv()

const resend = new Resend(appEnv.resendApiKey())

const backend = ((backendModule as any).default ?? backendModule) as any
const db = ((dbModule as any).default ?? dbModule) as any
const redis = ((redisModule as any).default ?? redisModule) as any

const buildSendMessage = backend.buildSendMessage as typeof import('../lib/backend.ts').buildSendMessage
const claimQueueJob = backend.claimQueueJob as typeof import('../lib/backend.ts').claimQueueJob
const deferQueueJob = backend.deferQueueJob as typeof import('../lib/backend.ts').deferQueueJob
const getNextBusinessWindow = backend.getNextBusinessWindow as typeof import('../lib/backend.ts').getNextBusinessWindow
const getRandomSendDelaySeconds = backend.getRandomSendDelaySeconds as typeof import('../lib/backend.ts').getRandomSendDelaySeconds
const isSuppressed = backend.isSuppressed as typeof import('../lib/backend.ts').isSuppressed
const loadQueueExecutionContext = backend.loadQueueExecutionContext as typeof import('../lib/backend.ts').loadQueueExecutionContext
const markQueueJobCompleted = backend.markQueueJobCompleted as typeof import('../lib/backend.ts').markQueueJobCompleted
const markQueueJobFailed = backend.markQueueJobFailed as typeof import('../lib/backend.ts').markQueueJobFailed
const markQueueJobSkipped = backend.markQueueJobSkipped as typeof import('../lib/backend.ts').markQueueJobSkipped
const popQueuedJob = backend.popQueuedJob as typeof import('../lib/backend.ts').popQueuedJob
const promoteReadyQueueJobs = backend.promoteReadyQueueJobs as typeof import('../lib/backend.ts').promoteReadyQueueJobs
const selectBestIdentity = backend.selectBestIdentity as typeof import('../lib/backend.ts').selectBestIdentity

const closePool = db.closePool as typeof import('../lib/db.ts').closePool
const closeRedis = redis.closeRedis as typeof import('../lib/redis.ts').closeRedis

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

  if (
    context.contact.status === 'bounced' ||
    context.contact.status === 'unsubscribed' ||
    context.contact.status === 'replied'
  ) {
    await markQueueJobSkipped(context, `contact is ${context.contact.status}`)
    return
  }

  if (await isSuppressed(context.job.client_id, context.contact.email)) {
    await markQueueJobSkipped(context, 'suppressed email')
    return
  }

  if (context.campaign.status === 'completed') {
    await markQueueJobSkipped(context, 'campaign completed')
    return
  }

  if (context.campaign.status !== 'active') {
    await deferQueueJob(
      context,
      new Date(Date.now() + 5 * 60 * 1000),
      `campaign is ${context.campaign.status}`
    )
    return
  }

  const selection = await selectBestIdentity(context.job.client_id)
  if (!selection) {
    await deferQueueJob(
      context,
      new Date(Date.now() + 60 * 1000),
      'no active identity available'
    )
    return
  }

  if (selection.identity.last_sent_at) {
    const randomDelaySeconds = getRandomSendDelaySeconds()
    const nextAllowedAt =
      new Date(selection.identity.last_sent_at).getTime() + randomDelaySeconds * 1000

    if (nextAllowedAt > Date.now()) {
      await deferQueueJob(
        context,
        new Date(nextAllowedAt),
        `identity cooling down for ${randomDelaySeconds}s`
      )
      return
    }
  }

  const nextBusinessWindow = getNextBusinessWindow(context.contact.timezone)
  if (nextBusinessWindow) {
    await deferQueueJob(context, nextBusinessWindow, 'outside contact business hours')
    return
  }

  const message = await buildSendMessage(context)
  if (message.spamFlags.length >= 2) {
    await deferQueueJob(
      context,
      new Date(Date.now() + 6 * 60 * 60 * 1000),
      `spam-risk copy: ${message.spamFlags.join(', ')}`
    )
    return
  }

  try {
    const response = await resend.emails.send({
      from: `Xavira Orbit <${selection.identity.email}>`,
      to: context.job.recipient_email || context.contact.email,
      cc: context.job.cc_emails ?? undefined,
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: {
        'X-Campaign-Id': String(context.campaign.id),
        'X-Queue-Job-Id': String(context.job.id),
        'List-Unsubscribe': `<${message.unsubscribeUrl}>`,
      },
    })

    if (response.error) {
      await markQueueJobFailed(context, response.error.message)
      console.error(
        `[Worker] provider error queue_job=${context.job.id} to=${context.contact.email}: ${response.error.message}`
      )
      return
    }

    await markQueueJobCompleted(context, selection, response.data?.id ?? null)
    console.log(
      `[Worker] sent queue_job=${context.job.id} to=${context.contact.email} identity=${selection.identity.email}`
    )
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'unknown worker send failure'
    await markQueueJobFailed(context, message)
    console.error(`[Worker] failed queue_job=${context.job.id}:`, error)
  }
}

async function main() {
  console.log('[Worker] starting Xavira Orbit worker')

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
