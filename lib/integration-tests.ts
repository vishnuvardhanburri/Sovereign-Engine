import 'dotenv/config'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { bulkCreateContacts, createCampaign, createDomain, createIdentity, createSequence, enqueueCampaignJobs } from '@/lib/backend'
import { closePool, query, queryOne } from '@/lib/db'
import { closeRedis } from '@/lib/redis'
import { appEnv } from '@/lib/env'

const TEST_CLIENT_ID = 9001
const TARGET_CONTACTS = 10

function getRecipientEmails() {
  const list = process.env.TEST_RECIPIENT_EMAILS
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  if (list && list.length >= TARGET_CONTACTS) {
    return list.slice(0, TARGET_CONTACTS)
  }

  const single = process.env.TEST_RECIPIENT_EMAIL?.trim()
  if (single) {
    const [localPart, domain] = single.split('@')
    if (!localPart || !domain) {
      throw new Error('TEST_RECIPIENT_EMAIL must be a valid email address')
    }

    return Array.from({ length: TARGET_CONTACTS }, (_, index) =>
      `${localPart}+xavira-${index + 1}@${domain}`
    )
  }

  throw new Error(
    'Set TEST_RECIPIENT_EMAILS or TEST_RECIPIENT_EMAIL before running the backend integration test'
  )
}

async function cleanup() {
  await query('DELETE FROM events WHERE client_id = $1', [TEST_CLIENT_ID])
  await query('DELETE FROM queue_jobs WHERE client_id = $1', [TEST_CLIENT_ID])
  await query('DELETE FROM identities WHERE client_id = $1', [TEST_CLIENT_ID])
  await query('DELETE FROM domains WHERE client_id = $1', [TEST_CLIENT_ID])
  await query('DELETE FROM campaigns WHERE client_id = $1', [TEST_CLIENT_ID])
  await query(
    'DELETE FROM sequence_steps WHERE sequence_id IN (SELECT id FROM sequences WHERE client_id = $1)',
    [TEST_CLIENT_ID]
  )
  await query('DELETE FROM sequences WHERE client_id = $1', [TEST_CLIENT_ID])
  await query('DELETE FROM suppression_list WHERE client_id = $1', [TEST_CLIENT_ID])
  await query('DELETE FROM contacts WHERE client_id = $1', [TEST_CLIENT_ID])
  await query('DELETE FROM clients WHERE id = $1', [TEST_CLIENT_ID])
}

async function waitForSentEvents(campaignId: number, expected: number) {
  const timeoutAt = Date.now() + 120_000

  while (Date.now() < timeoutAt) {
    const row = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM events
       WHERE client_id = $1
         AND campaign_id = $2
         AND event_type = 'sent'`,
      [TEST_CLIENT_ID, campaignId]
    )

    const count = Number(row?.count ?? 0)
    if (count >= expected) {
      return count
    }

    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  throw new Error(`Timed out waiting for ${expected} sent events`)
}

async function main() {
  appEnv.databaseUrl()
  appEnv.redisUrl()
  appEnv.resendApiKey()
  appEnv.appBaseUrl()

  // If local DB/Redis are not running, skip unless explicitly required.
  try {
    await queryOne<{ ok: number }>('SELECT 1 as ok')
  } catch (error) {
    if (process.env.REQUIRE_INTEGRATION_DB === 'true') {
      throw error
    }
    console.warn('[IntegrationTest] Skipping: database is not reachable. Set REQUIRE_INTEGRATION_DB=true to enforce.')
    return
  }

  const recipientEmails = getRecipientEmails()
  await cleanup()

  await query('INSERT INTO clients (id, name) VALUES ($1, $2)', [
    TEST_CLIENT_ID,
    'Integration Test Client',
  ])

  const domain = await createDomain(TEST_CLIENT_ID, {
    domain: process.env.TEST_SENDING_DOMAIN ?? 'example.com',
    dailyLimit: 4000,
  })

  if (!domain) {
    throw new Error('Failed to create test domain')
  }

  const identity = await createIdentity(TEST_CLIENT_ID, {
    domainId: Number(domain.id),
    email:
      process.env.TEST_SENDER_EMAIL ??
      `sender@${String(domain.domain).replace(/^@/, '')}`,
    dailyLimit: 400,
  })

  if (!identity) {
    throw new Error('Failed to create test identity')
  }

  const contacts = await bulkCreateContacts(
    TEST_CLIENT_ID,
    recipientEmails.map((email, index) => ({
      email,
      name: `Test Contact ${index + 1}`,
      company: 'Xavira QA',
    }))
  )

  const sequence = await createSequence(TEST_CLIENT_ID, {
    name: 'Integration Validation Sequence',
    steps: [
      {
        day: 0,
        subject: 'Validation email for {{FirstName}}',
        body: 'Hi {{FirstName}},\n\nThis is a live validation message from Xavira Orbit.\n\nThanks,\nQA',
      },
    ],
  })

  const campaign = await createCampaign(TEST_CLIENT_ID, {
    name: 'Integration Validation Campaign',
    sequenceId: Number(sequence.id),
  })

  if (!campaign) {
    throw new Error('Failed to create validation campaign')
  }

  const enqueueResult = await enqueueCampaignJobs(TEST_CLIENT_ID, Number(campaign.id))
  if (enqueueResult.contactCount !== TARGET_CONTACTS) {
    throw new Error(
      `Expected ${TARGET_CONTACTS} queued contacts, got ${enqueueResult.contactCount}`
    )
  }

  const worker = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['tsx', path.join(process.cwd(), 'worker/index.ts')],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        APP_BASE_URL: process.env.APP_BASE_URL ?? 'http://localhost:3000',
        DEFAULT_CLIENT_ID: String(TEST_CLIENT_ID),
        MIN_SEND_DELAY_SECONDS: process.env.MIN_SEND_DELAY_SECONDS ?? '1',
        MAX_SEND_DELAY_SECONDS: process.env.MAX_SEND_DELAY_SECONDS ?? '2',
        WORKER_POLL_INTERVAL_MS: process.env.WORKER_POLL_INTERVAL_MS ?? '250',
        WORKER_IDLE_SLEEP_MS: process.env.WORKER_IDLE_SLEEP_MS ?? '250',
      },
      stdio: 'inherit',
    }
  )

  try {
    const sentCount = await waitForSentEvents(Number(campaign.id), TARGET_CONTACTS)
    console.log(
      `Validation complete: ${sentCount} sent events recorded for campaign ${campaign.id}`
    )
  } finally {
    worker.kill('SIGTERM')
    await cleanup()
    await Promise.allSettled([closeRedis(), closePool()])
  }
}

main().catch(async (error) => {
  console.error('Integration validation failed:', error)
  await Promise.allSettled([closeRedis(), closePool()])
  process.exit(1)
})
