/* eslint-disable no-console */
import 'dotenv/config'
import { query, queryOne } from '@/lib/db'
import { appEnv } from '@/lib/env'
import {
  createCampaign,
  createDomain,
  createIdentity,
  createSequence,
  importContacts,
  updateCampaignStatus,
} from '@/lib/backend'

function requireArg(idx: number, name: string) {
  const v = String(process.argv[idx] ?? '').trim()
  if (!v) {
    console.error(`Usage: pnpm demo:outbound <recipient_email> <target_company> [name]`)
    process.exit(1)
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

  const recipientEmail = requireArg(2, 'recipient_email').toLowerCase()
  const company = requireArg(3, 'target_company')
  const name = String(process.argv[4] ?? 'Demo Lead').trim()

  // Pick the first SMTP account as our sending identity for bootstrapping.
  // Rotation is handled by sender-worker at send time; identities are for domain configuration + UI.
  const smtpAccounts = appEnv.smtpAccounts()
  if (!smtpAccounts.length) {
    console.error('No SMTP_ACCOUNTS found in env. Set SMTP_ACCOUNTS before running demo setup.')
    process.exit(1)
  }

  const fromEmails = smtpAccounts.map((a) => a.user.trim().toLowerCase())
  const domains = Array.from(new Set(fromEmails.map((e) => e.split('@')[1]).filter(Boolean)))
  if (!domains.length) {
    console.error('SMTP_ACCOUNTS users are invalid. Expected email addresses.')
    process.exit(1)
  }

  // Ensure domains + identities exist in DB so sending-engine has something to rotate.
  for (const d of domains) {
    const dom = await getOrCreateDomain(clientId, d)
    for (const e of fromEmails.filter((x) => x.endsWith(`@${d}`))) {
      await getOrCreateIdentity(clientId, dom.id, e)
    }
  }

  // Import contact in manual_upload mode so manual campaigns can target it.
  const imported = await importContacts(clientId, {
    contacts: [
      {
        email: recipientEmail,
        name,
        company,
        title: 'Founder',
        source: 'manual_upload',
        timezone: 'UTC',
      },
    ],
    verify: false,
    enrich: false,
    dedupeByDomain: false,
  })
  const contact = imported[0]
  if (!contact) throw new Error('Failed to import contact')

  const now = new Date()
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-')

  const sequence = await createSequence(clientId, {
    name: `Demo Sequence ${stamp}`,
    steps: [
      {
        day: 0,
        touchLabel: 'touch_1',
        variantKey: 'primary',
        recipientStrategy: 'primary',
        ccMode: 'none',
        subject: `Quick question about ${company}`,
        body: `Hi ${name},\n\nSaw ${company} and had a quick question.\n\nWe run an outbound system that controls sending instead of blasting, which helps protect domains and improve replies.\n\nOpen to a quick 10 to 15 min chat?\n\nThanks,`,
      },
    ],
  })

  const campaign = await createCampaign(clientId, {
    sequenceId: Number(sequence.id),
    name: `Demo Campaign ${stamp}`,
    audienceMode: 'manual',
    // For demo/testing we want the first touch to enqueue immediately.
    // dailyTarget=1 => second_slot=0 in enqueue pacing.
    dailyTarget: 1,
    durationDays: 1,
    fromIdentityMode: 'rotate',
    timezoneStrategy: 'utc',
    abTestEnabled: false,
  } as any)
  if (!campaign) throw new Error('Failed to create campaign')

  await updateCampaignStatus(clientId, Number(campaign.id), 'active', [Number(contact.id)])

  const queued = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM queue_jobs
     WHERE client_id = $1 AND campaign_id = $2`,
    [clientId, Number(campaign.id)]
  )

  console.log('Demo outbound setup complete:')
  console.log(JSON.stringify({
    clientId,
    campaignId: Number(campaign.id),
    sequenceId: Number(sequence.id),
    contactId: Number(contact.id),
    queuedJobs: Number(queued.rows[0]?.count ?? 0),
    recipientEmail,
  }, null, 2))
}

main().catch((err) => {
  console.error('Failed to setup demo outbound', err)
  process.exit(1)
})
