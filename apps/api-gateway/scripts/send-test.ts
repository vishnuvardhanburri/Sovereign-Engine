/* eslint-disable no-console */
import 'dotenv/config'
import { Queue } from 'bullmq'
import { queryOne } from '@/lib/db'
import { appEnv } from '@/lib/env'
import { createDomain, createIdentity } from '@/lib/backend'

function arg(name: string): string | null {
  const idx = process.argv.findIndex((x) => x === `--${name}`)
  if (idx === -1) return null
  const v = String(process.argv[idx + 1] ?? '').trim()
  return v || null
}

function requireArg(name: string) {
  const v = arg(name)
  if (!v) {
    return null
  }
  return v
}

async function getOrCreateDomain(clientId: number, domain: string) {
  const d = domain.trim().toLowerCase()
  const existing = await queryOne<{ id: number; domain: string }>(
    `SELECT id, domain
     FROM domains
     WHERE client_id = $1 AND domain = $2
     LIMIT 1`,
    [clientId, d]
  )
  if (existing) return existing
  const created = await createDomain(clientId, { domain: d })
  if (!created) throw new Error(`Failed to create domain ${d}`)
  return { id: Number(created.id), domain: created.domain }
}

async function getOrCreateIdentity(clientId: number, domainId: number, email: string) {
  const e = email.trim().toLowerCase()
  const existing = await queryOne<{ id: number; email: string }>(
    `SELECT id, email
     FROM identities
     WHERE client_id = $1 AND domain_id = $2 AND email = $3
     LIMIT 1`,
    [clientId, domainId, e]
  )
  if (existing) return existing
  const created = await createIdentity(clientId, { domainId, email: e })
  if (!created) throw new Error(`Failed to create identity ${e}`)
  return { id: Number(created.id), email: created.email }
}

async function main() {
  const clientId = appEnv.defaultClientId()
  if (!arg('to')) {
    console.log('No --to provided; defaulting to vishnuvardhanburri19@gmail.com')
    console.log('Usage: pnpm send:test [--to <email>] [--company <name>] [--name <name>]')
  }
  const to = String(requireArg('to') ?? 'vishnuvardhanburri19@gmail.com').toLowerCase()
  const company = String(arg('company') ?? 'Test Company').trim()
  const name = String(arg('name') ?? 'Vishnu').trim()

  const smtpAccounts = appEnv.smtpAccounts()
  if (!smtpAccounts.length) {
    console.error('No SMTP_ACCOUNTS found in env. Set SMTP_ACCOUNTS before running send:test.')
    process.exit(1)
  }

  // Ensure domains + identities exist so rotation has material to work with.
  const fromEmails = smtpAccounts.map((a) => a.user.trim().toLowerCase())
  const domains = Array.from(new Set(fromEmails.map((e) => e.split('@')[1]).filter(Boolean)))
  for (const d of domains) {
    const dom = await getOrCreateDomain(clientId, d)
    for (const e of fromEmails.filter((x) => x.endsWith(`@${d}`))) {
      await getOrCreateIdentity(clientId, dom.id, e)
    }
  }

  const sendQueue = process.env.SEND_QUEUE ?? 'xv-send-queue'
  const q = new Queue(sendQueue, { connection: { url: appEnv.redisUrl() } })

  const idem = `send_test_${Date.now()}_${Math.random().toString(16).slice(2)}`
  const subject = `[Xavira Orbit Test] SMTP check for ${company}`
  const text = `Hi ${name},\n\nThis is a Xavira Orbit test email for ${company}.\n\nIf you see this, SMTP is working and events should record it.\n`

  const id = await q.add(
    'send_test',
    {
      clientId,
      toEmail: to,
      subject,
      text,
      idempotencyKey: idem,
    },
    { removeOnComplete: true, removeOnFail: false, attempts: 3, backoff: { type: 'exponential', delay: 10_000 } }
  )

  console.log('Enqueued BullMQ send-test job:')
  console.log(JSON.stringify({ queue: sendQueue, jobId: id.id, to, subject, clientId }, null, 2))
  await q.close()
}

main().catch((err) => {
  console.error('send:test failed', err)
  process.exit(1)
})
