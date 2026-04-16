import { Resend } from 'resend'
import {
  buildSendMessage,
  claimQueueJob,
  deferQueueJob,
  getNextBusinessWindow,
  getRandomSendDelaySeconds,
  isSuppressed,
  loadQueueExecutionContext,
  markQueueJobCompleted,
  markQueueJobFailed,
  markQueueJobSkipped,
  popQueuedJob,
  promoteReadyQueueJobs,
  selectBestIdentity,
} from '../lib/backend'
import { closePool } from '../lib/db'
import { closeRedis } from '../lib/redis'
import { appEnv, validateWorkerEnv } from '../lib/env'

validateWorkerEnv()

const resend = new Resend(appEnv.resendApiKey())

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
