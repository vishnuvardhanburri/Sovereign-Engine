import {
  Campaign,
  CampaignRow,
  CampaignStatus,
  ClientUser,
  Contact,
  ContactStatus,
  Domain,
  DomainStatus,
  DomainWithStats,
  Event,
  EventType,
  Identity,
  QueueJob,
  QueueJobStatus,
  Sequence,
  SequenceStep,
  User,
  VerificationStatus,
  WebhookEvent,
} from '@/lib/db/types'
import { query, queryOne, transaction, QueryExecutor } from '@/lib/db'
import {
  enqueueQueueJobs,
  enqueueQueueJob,
  popReadyQueueJob,
  promoteDueQueueJobs,
  requeueQueueJob,
  RedisQueueJobPayload,
} from '@/lib/redis'
import { appEnv } from '@/lib/env'
import { createPaginatedResponse, getPaginationParams } from '@/lib/pagination'
import { classifyReplyText, logOperatorAction, prepareCampaignOperatorPlan, validateSequenceStepCopy } from '@/lib/operator'
import { assignUserToClient, listClientUsers, MembershipRole, upsertUser } from '@/lib/authz'
import {
  buildUnsubscribeUrl,
  findContactByProviderMessageId,
  markContactUnsubscribed,
  parseUnsubscribeToken,
} from '@/lib/compliance'
import { enrichContactProfile } from '@/lib/integrations/enrichment'
import { classifyReplyWithAi } from '@/lib/integrations/openrouter'
import { verifyEmailAddress } from '@/lib/integrations/zerobounce'
import { buildPersonalizedMessage, isBusinessHourForTimezone, renderVariables } from '@/lib/personalization'

export interface PaginationInput {
  page?: number
  limit?: number
}

export interface ContactInput {
  email: string
  name?: string
  company?: string
  title?: string
  timezone?: string
  source?: string
  companyDomain?: string
  customFields?: Record<string, unknown>
}

export interface SequenceInput {
  name: string
  steps: Array<{
    day: number
    touchLabel?: string
    variantKey?: string
    recipientStrategy?: 'primary' | 'cxo' | 'generic' | 'fallback'
    ccMode?: 'none' | 'manager' | 'team'
    subject: string
    body: string
  }>
}

export interface CampaignInput {
  name: string
  sequenceId: number
  contactIds?: number[]
  angle?: 'pattern' | 'pain' | 'authority'
  fromIdentityMode?: 'rotate' | 'sticky' | 'manual'
  timezoneStrategy?: 'contact' | 'client' | 'utc'
  abTestEnabled?: boolean
  dailyTarget?: number
}

export interface QueueExecutionContext {
  job: QueueJob
  campaign: Campaign
  contact: Contact
  sequenceStep: SequenceStep
}

export interface ContactImportOptions {
  contacts: ContactInput[]
  verify?: boolean
  enrich?: boolean
  dedupeByDomain?: boolean
}

export interface SendIdentitySelection {
  identity: Identity
  domain: Domain
}

const MAX_PAGE_SIZE = 100

function firstRow<T>(result: { rows: T[] }): T | null {
  return result.rows[0] ?? null
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function getSafePage(input?: PaginationInput) {
  const rawPage = input?.page ?? 1
  const rawLimit = input?.limit ?? 50

  return getPaginationParams({
    page: clamp(rawPage, 1, 1_000_000),
    limit: clamp(rawLimit, 1, MAX_PAGE_SIZE),
  })
}

function renderTemplate(template: string, contact: Contact): string {
  return renderVariables(template, contact)
}

function toQueuePayload(job: QueueJob): RedisQueueJobPayload {
  return {
    id: job.id,
    client_id: job.client_id,
    contact_id: job.contact_id,
    campaign_id: job.campaign_id,
    sequence_step: job.sequence_step,
    scheduled_at: job.scheduled_at,
  }
}

async function insertSuppressionIfNeeded(
  executor: QueryExecutor,
  clientId: number,
  email: string,
  reason: 'unsubscribed' | 'bounced' | 'duplicate' | 'complaint' | 'manual',
  source: string | null
): Promise<void> {
  await executor(
    `INSERT INTO suppression_list (client_id, email, reason, source)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (client_id, email) DO UPDATE
     SET reason = EXCLUDED.reason,
         source = EXCLUDED.source`,
    [clientId, normalizeEmail(email), reason, source]
  )
}

export async function listContacts(
  clientId: number,
  input: PaginationInput & { campaignId?: number } = {}
) {
  const { page, limit, offset } = getSafePage(input)
  const params: unknown[] = [clientId]
  let where = 'WHERE c.client_id = $1'

  if (input.campaignId) {
    params.push(input.campaignId)
    where += ` AND EXISTS (
      SELECT 1
      FROM queue_jobs qj
      WHERE qj.client_id = c.client_id
        AND qj.contact_id = c.id
        AND qj.campaign_id = $${params.length}
    )`
  }

  params.push(limit, offset)

  const [rows, count] = await Promise.all([
    query<Contact>(
      `SELECT c.*
       FROM contacts c
       ${where}
       ORDER BY c.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM contacts c
       ${where}`,
      params.slice(0, params.length - 2)
    ),
  ])

  return createPaginatedResponse(
    rows.rows,
    Number(count?.count ?? 0),
    page,
    limit
  )
}

export async function bulkCreateContacts(
  clientId: number,
  contacts: ContactInput[]
): Promise<Contact[]> {
  const deduped = Array.from(
    new Map(
      contacts
        .map((contact) => ({
          email: normalizeEmail(contact.email),
          name: contact.name?.trim() || '',
          company: contact.company?.trim() || '',
          title: contact.title?.trim() || '',
          timezone: contact.timezone?.trim() || '',
          source: contact.source?.trim() || 'api',
          companyDomain:
            contact.companyDomain?.trim().toLowerCase() ||
            contact.company?.trim().toLowerCase().replace(/\s+/g, '') ||
            '',
          customFields:
            contact.customFields ??
            ((contact as ContactInput & { custom_fields?: Record<string, unknown> }).custom_fields ?? {}),
        }))
        .filter((contact) => contact.email)
        .map((contact) => [contact.email, contact] as const)
    ).values()
  )

  if (deduped.length === 0) {
    return []
  }

  const emails = deduped.map((contact) => contact.email)
  const emailDomains = deduped.map((contact) => contact.email.split('@')[1] ?? null)
  const names = deduped.map((contact) => contact.name)
  const companies = deduped.map((contact) => contact.company)
  const titles = deduped.map((contact) => contact.title)
  const timezones = deduped.map((contact) => contact.timezone)
  const sources = deduped.map((contact) => contact.source)
  const companyDomains = deduped.map((contact) => contact.companyDomain || null)
  const customFields = deduped.map((contact) => JSON.stringify(contact.customFields))

  const result = await query<Contact>(
    `INSERT INTO contacts (
       client_id,
       email,
       email_domain,
       name,
       company,
       company_domain,
       title,
       timezone,
       source,
       custom_fields,
       verification_status,
       status
     )
     SELECT
       $1,
       email,
       email_domain,
       NULLIF(name, ''),
       NULLIF(company, ''),
       NULLIF(company_domain, ''),
       NULLIF(title, ''),
       NULLIF(timezone, ''),
       NULLIF(source, ''),
       custom_fields::jsonb,
       'pending',
       'active'
     FROM UNNEST(
       $2::text[],
       $3::text[],
       $4::text[],
       $5::text[],
       $6::text[],
       $7::text[],
       $8::text[],
       $9::text[],
       $10::text[]
     ) AS t(email, email_domain, name, company, company_domain, title, timezone, source, custom_fields)
     ON CONFLICT (client_id, email) DO UPDATE
     SET name = COALESCE(NULLIF(EXCLUDED.name, ''), contacts.name),
         company = COALESCE(NULLIF(EXCLUDED.company, ''), contacts.company),
         company_domain = COALESCE(NULLIF(EXCLUDED.company_domain, ''), contacts.company_domain),
         title = COALESCE(NULLIF(EXCLUDED.title, ''), contacts.title),
         timezone = COALESCE(NULLIF(EXCLUDED.timezone, ''), contacts.timezone),
         source = COALESCE(NULLIF(EXCLUDED.source, ''), contacts.source),
         email_domain = COALESCE(EXCLUDED.email_domain, contacts.email_domain),
         custom_fields = COALESCE(contacts.custom_fields, '{}'::jsonb) || COALESCE(EXCLUDED.custom_fields, '{}'::jsonb),
         updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [
      clientId,
      emails,
      emailDomains,
      names,
      companies,
      companyDomains,
      titles,
      timezones,
      sources,
      customFields,
    ]
  )

  return result.rows
}

export async function deleteContact(clientId: number, contactId: number) {
  const deleted = await queryOne<Contact>(
    `DELETE FROM contacts
     WHERE client_id = $1 AND id = $2
     RETURNING *`,
    [clientId, contactId]
  )

  return deleted
}

function parseCsvRow(line: string) {
  const cells: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]

    if (char === '"' && inQuotes && next === '"') {
      current += '"'
      index += 1
      continue
    }

    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (char === ',' && !inQuotes) {
      cells.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  cells.push(current.trim())
  return cells
}

export function parseContactsCsv(csv: string): ContactInput[] {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length < 2) {
    return []
  }

  const headers = parseCsvRow(lines[0]).map((header) => header.trim().toLowerCase())

  return lines.slice(1).map((line) => {
    const values = parseCsvRow(line)
    const record: Record<string, string> = {}

    headers.forEach((header, index) => {
      record[header] = values[index] ?? ''
    })

    const reserved = new Set(['email', 'name', 'company', 'title', 'timezone', 'source', 'company_domain'])
    const customFields = Object.fromEntries(
      Object.entries(record).filter(([key, value]) => !reserved.has(key) && value)
    )

    return {
      email: record.email || '',
      name: record.name || undefined,
      company: record.company || undefined,
      title: record.title || undefined,
      timezone: record.timezone || undefined,
      source: record.source || 'csv',
      companyDomain: record.company_domain || undefined,
      customFields,
    } satisfies ContactInput
  })
}

export async function importContacts(
  clientId: number,
  input: ContactImportOptions
) {
  const initial = input.dedupeByDomain
    ? Array.from(
        new Map(
          input.contacts
            .filter((contact) => contact.email)
            .map((contact) => [
              normalizeEmail(contact.email).split('@')[1] ?? normalizeEmail(contact.email),
              contact,
            ] as const)
        ).values()
      )
    : input.contacts

  const contacts = await bulkCreateContacts(clientId, initial)
  if (contacts.length === 0) {
    return []
  }

  for (const contact of contacts) {
    let verificationStatus: VerificationStatus | undefined
    let verificationSubStatus: string | null | undefined
    let enrichment: Record<string, unknown> | null | undefined

    if (input.verify) {
      const verification = await verifyEmailAddress(contact.email)
      verificationStatus = verification.status
      verificationSubStatus = verification.subStatus
    }

    if (input.enrich) {
      const enriched = await enrichContactProfile({
        email: contact.email,
        name: contact.name,
        companyDomain: contact.company_domain,
      })
      enrichment = enriched.data
    }

    if (verificationStatus || enrichment !== undefined) {
      await query(
        `UPDATE contacts
         SET verification_status = COALESCE($3, verification_status),
             verification_sub_status = COALESCE($4, verification_sub_status),
             enrichment = COALESCE($5, enrichment),
             updated_at = CURRENT_TIMESTAMP
         WHERE client_id = $1 AND id = $2`,
        [
          clientId,
          contact.id,
          verificationStatus ?? null,
          verificationSubStatus ?? null,
          enrichment ?? null,
        ]
      )

      if (verificationStatus && verificationStatus !== 'valid' && verificationStatus !== 'pending') {
        await insertSuppressionIfNeeded(
          query,
          clientId,
          contact.email,
          verificationStatus === 'do_not_mail' ? 'manual' : 'bounced',
          'verification'
        )
      }
    }
  }

  return query<Contact>(
    `SELECT *
     FROM contacts
     WHERE client_id = $1
       AND id = ANY($2::bigint[])
     ORDER BY created_at DESC`,
    [clientId, contacts.map((contact) => contact.id)]
  ).then((result) => result.rows)
}

async function fetchSequences(
  clientId: number,
  sequenceId?: number
): Promise<Array<Sequence & { steps: SequenceStep[] }>> {
  const params: unknown[] = [clientId]
  let where = 'WHERE s.client_id = $1'

  if (sequenceId) {
    params.push(sequenceId)
    where += ` AND s.id = $2`
  }

  const sequences = await query<Sequence>(
    `SELECT s.*
     FROM sequences s
     ${where}
     ORDER BY s.updated_at DESC`,
    params
  )

  if (sequences.rows.length === 0) {
    return []
  }

  const sequenceIds = sequences.rows.map((sequence) => sequence.id)
  const steps = await query<SequenceStep>(
    `SELECT *
     FROM sequence_steps
     WHERE sequence_id = ANY($1::bigint[])
     ORDER BY sequence_id, step_index`,
    [sequenceIds]
  )

  const stepsBySequence = new Map<number, SequenceStep[]>()
  for (const step of steps.rows) {
    const list = stepsBySequence.get(step.sequence_id) ?? []
    list.push(step)
    stepsBySequence.set(step.sequence_id, list)
  }

  return sequences.rows.map((sequence) => ({
    ...sequence,
    steps: stepsBySequence.get(sequence.id) ?? [],
  }))
}

export async function listSequences(clientId: number) {
  return fetchSequences(clientId)
}

export async function getSequence(clientId: number, sequenceId: number) {
  const sequences = await fetchSequences(clientId, sequenceId)
  return sequences[0] ?? null
}

export async function createSequence(clientId: number, input: SequenceInput) {
  return transaction(async (executor) => {
    const createdSequence = await executor<Sequence>(
      `INSERT INTO sequences (client_id, name)
       VALUES ($1, $2)
       RETURNING *`,
      [clientId, input.name.trim()]
    )

    const sequence = firstRow(createdSequence)
    if (!sequence) {
      throw new Error('Failed to create sequence')
    }

    for (const [index, step] of input.steps.entries()) {
      await executor(
        `INSERT INTO sequence_steps (
          sequence_id,
          step_index,
          day_delay,
          touch_label,
          variant_key,
          recipient_strategy,
          cc_mode,
          subject,
          body
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          sequence.id,
          index + 1,
          Math.max(step.day, 0),
          step.touchLabel ?? `touch_${index + 1}`,
          step.variantKey ?? 'primary',
          step.recipientStrategy ?? 'primary',
          step.ccMode ?? 'none',
          step.subject.trim(),
          step.body,
        ]
      )
    }

    return fetchSequences(clientId, sequence.id).then((sequences) => sequences[0]!)
  })
}

export async function updateSequence(
  clientId: number,
  sequenceId: number,
  input: SequenceInput
) {
  return transaction(async (executor) => {
    const updated = await executor<Sequence>(
      `UPDATE sequences
       SET name = $3, updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1 AND id = $2
       RETURNING *`,
      [clientId, sequenceId, input.name.trim()]
    )

    if (!firstRow(updated)) {
      return null
    }

    await executor('DELETE FROM sequence_steps WHERE sequence_id = $1', [sequenceId])

    for (const [index, step] of input.steps.entries()) {
      await executor(
        `INSERT INTO sequence_steps (
          sequence_id,
          step_index,
          day_delay,
          touch_label,
          variant_key,
          recipient_strategy,
          cc_mode,
          subject,
          body
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          sequenceId,
          index + 1,
          Math.max(step.day, 0),
          step.touchLabel ?? `touch_${index + 1}`,
          step.variantKey ?? 'primary',
          step.recipientStrategy ?? 'primary',
          step.ccMode ?? 'none',
          step.subject.trim(),
          step.body,
        ]
      )
    }

    return fetchSequences(clientId, sequenceId).then((sequences) => sequences[0]!)
  })
}

export async function listCampaigns(clientId: number) {
  const rows = await query<CampaignRow>(
    `SELECT
       c.*,
       s.name AS sequence_name
     FROM campaigns c
     JOIN sequences s ON s.id = c.sequence_id
     WHERE c.client_id = $1
     ORDER BY c.created_at DESC`,
    [clientId]
  )

  return rows.rows
}

export async function getCampaign(clientId: number, campaignId: number) {
  return queryOne<CampaignRow>(
    `SELECT
       c.*,
       s.name AS sequence_name
     FROM campaigns c
     JOIN sequences s ON s.id = c.sequence_id
     WHERE c.client_id = $1 AND c.id = $2`,
    [clientId, campaignId]
  )
}

export async function createCampaign(clientId: number, input: CampaignInput) {
  const sequence = await getSequence(clientId, input.sequenceId)
  if (!sequence) {
    throw new Error('Sequence not found')
  }

  const created = await queryOne<Campaign>(
    `INSERT INTO campaigns (
       client_id,
       sequence_id,
       name,
       status,
       angle,
       from_identity_mode,
       timezone_strategy,
       ab_test_enabled,
       daily_target
     )
     VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      clientId,
      input.sequenceId,
      input.name.trim(),
      input.angle ?? 'pattern',
      input.fromIdentityMode ?? 'rotate',
      input.timezoneStrategy ?? 'contact',
      input.abTestEnabled ?? false,
      input.dailyTarget ?? 50,
    ]
  )

  return created
}

async function getEligibleContactScope(
  executor: QueryExecutor,
  clientId: number,
  startIndex: number,
  contactIds?: number[]
) {
  const filters: string[] = [
    `c.client_id = $${startIndex}`,
    "c.status = 'active'",
    `c.verification_status NOT IN ('invalid', 'do_not_mail')`,
    `NOT EXISTS (
      SELECT 1
      FROM suppression_list s
      WHERE s.client_id = c.client_id
        AND s.email = c.email
    )`,
  ]
  const params: unknown[] = [clientId]

  if (contactIds && contactIds.length > 0) {
    params.push(contactIds)
    filters.push(`c.id = ANY($${startIndex + params.length - 1}::bigint[])`)
  }

  const where = filters.join(' AND ')
  const count = await executor<{ count: string }>(
    `SELECT COUNT(DISTINCT c.email)::text AS count
     FROM contacts c
     WHERE ${where}`,
    params
  )

  return {
    where,
    params,
    count: Number(firstRow(count)?.count ?? 0),
  }
}

export async function enqueueCampaignJobs(
  clientId: number,
  campaignId: number,
  contactIds?: number[]
) {
  const operatorPlan = await prepareCampaignOperatorPlan({
    clientId,
    campaignId,
  })

  const payload = await transaction(async (executor) => {
    const campaignResult = await executor<Campaign>(
      `UPDATE campaigns
       SET status = 'active', updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1 AND id = $2
       RETURNING *`,
      [clientId, campaignId]
    )

    const campaign = firstRow(campaignResult)
    if (!campaign) {
      throw new Error('Campaign not found')
    }

    const steps = await executor<SequenceStep>(
      `SELECT *
       FROM sequence_steps
       WHERE sequence_id = $1
       ORDER BY step_index`,
      [campaign.sequence_id]
    )

    if (steps.rows.length === 0) {
      throw new Error('Campaign sequence has no steps')
    }

    if (steps.rows.length < 6) {
      await executor('DELETE FROM sequence_steps WHERE sequence_id = $1', [
        campaign.sequence_id,
      ])

      for (const [index, step] of operatorPlan.steps.entries()) {
        validateSequenceStepCopy(step)
        await executor(
          `INSERT INTO sequence_steps (
            sequence_id,
            step_index,
            day_delay,
            subject,
            body
          )
          VALUES ($1, $2, $3, $4, $5)`,
          [
            campaign.sequence_id,
            index + 1,
            Math.max(step.day - 1, 0),
            step.subject,
            step.body,
          ]
        )
      }
    }

    const scope = await getEligibleContactScope(executor, clientId, 1, contactIds)
    const insertedJobs = await executor<QueueJob>(
      `INSERT INTO queue_jobs (
         client_id,
         contact_id,
         campaign_id,
         sequence_step,
         scheduled_at,
         recipient_email,
         cc_emails,
         metadata,
         status,
         attempts,
         max_attempts
       )
       SELECT
         $1,
         c.id,
         $2,
         ss.step_index,
         CURRENT_TIMESTAMP + make_interval(days => ss.day_delay),
         c.email,
         CASE
           WHEN ss.cc_mode = 'none' THEN NULL
           ELSE '[]'::jsonb
         END,
         jsonb_build_object(
           'email_domain', c.email_domain,
           'company_domain', c.company_domain,
           'touch_label', ss.touch_label,
           'variant_key', ss.variant_key,
           'recipient_strategy', ss.recipient_strategy,
           'cc_mode', ss.cc_mode
         ),
         'pending',
         0,
         3
       FROM contacts c
       JOIN sequence_steps ss ON ss.sequence_id = $3
       WHERE ${scope.where.replaceAll('$1', '$4').replaceAll('$2', '$5')}
       ON CONFLICT (campaign_id, contact_id, sequence_step) DO NOTHING
       RETURNING *`,
      [
        clientId,
        campaignId,
        campaign.sequence_id,
        clientId,
        ...(contactIds && contactIds.length > 0 ? [contactIds] : []),
      ]
    )

    await executor(
      `UPDATE campaigns
       SET contact_count = $3,
           last_enqueued_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1 AND id = $2`,
      [
        clientId,
        campaignId,
        scope.count,
      ]
    )

    await executor(
      `UPDATE campaigns
       SET angle = $3,
           daily_target = CASE
             WHEN $4 = 'increase' THEN GREATEST(daily_target, 75)
             WHEN $4 = 'decrease' THEN LEAST(daily_target, 25)
             ELSE daily_target
           END,
           updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1 AND id = $2`,
      [clientId, campaignId, operatorPlan.angle, operatorPlan.volumeAction]
    )

    return {
      jobs: insertedJobs.rows.map(toQueuePayload),
      contactCount: scope.count,
    }
  })

  await enqueueQueueJobs(payload.jobs)

  return payload
}

export async function updateCampaignStatus(
  clientId: number,
  campaignId: number,
  status: CampaignStatus,
  contactIds?: number[]
) {
  if (status === 'active') {
    await enqueueCampaignJobs(clientId, campaignId, contactIds)
  } else {
    await query(
      `UPDATE campaigns
       SET status = $3, updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1 AND id = $2`,
      [clientId, campaignId, status]
    )
  }

  return getCampaign(clientId, campaignId)
}

export async function createDomain(
  clientId: number,
  input: { domain: string; dailyLimit?: number }
) {
  return queryOne<Domain>(
    `INSERT INTO domains (client_id, domain, daily_limit)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [clientId, input.domain.trim().toLowerCase(), clamp(input.dailyLimit ?? 400, 200, 5_000)]
  )
}

export async function listDomains(clientId: number) {
  const result = await query<DomainWithStats & { reply_events: string }>(
    `SELECT
       d.*,
       COUNT(DISTINCT i.id)::int AS identity_count,
       GREATEST(d.daily_limit - d.sent_today, 0)::int AS capacity_remaining,
       COUNT(CASE WHEN e.event_type = 'reply' THEN 1 END)::text AS reply_events
     FROM domains d
     LEFT JOIN identities i ON i.domain_id = d.id
     LEFT JOIN events e ON e.domain_id = d.id
     WHERE d.client_id = $1
     GROUP BY d.id
     ORDER BY d.created_at DESC`,
    [clientId]
  )

  return result.rows.map((domain) => {
    const sentCount = Number(domain.sent_count)
    const replyEvents = Number((domain as unknown as { reply_events: string }).reply_events ?? 0)
    const replyRate =
      sentCount > 0 ? Number(((replyEvents / sentCount) * 100).toFixed(2)) : 0

    return {
      ...domain,
      id: Number(domain.id),
      client_id: Number(domain.client_id),
      daily_limit: Number(domain.daily_limit),
      sent_today: Number(domain.sent_today),
      sent_count: sentCount,
      bounce_count: Number(domain.bounce_count),
      health_score: Number(domain.health_score),
      bounce_rate: Number(domain.bounce_rate),
      identity_count: Number(domain.identity_count),
      capacity_remaining: Number(domain.capacity_remaining),
      reply_rate: replyRate,
    }
  })
}

export async function updateDomainStatus(
  clientId: number,
  domainId: number,
  status: DomainStatus
) {
  return queryOne<Domain>(
    `UPDATE domains
     SET status = $3, updated_at = CURRENT_TIMESTAMP
     WHERE client_id = $1 AND id = $2
     RETURNING *`,
    [clientId, domainId, status]
  )
}

export async function createIdentity(
  clientId: number,
  input: { domainId: number; email: string; dailyLimit?: number }
) {
  const domain = await queryOne<Domain>(
    `SELECT *
     FROM domains
     WHERE client_id = $1 AND id = $2`,
    [clientId, input.domainId]
  )

  if (!domain) {
    throw new Error('Domain not found')
  }

  const email = normalizeEmail(input.email)
  if (!email.endsWith(`@${domain.domain}`)) {
    throw new Error('Identity email must belong to the selected domain')
  }

  return queryOne<Identity>(
    `INSERT INTO identities (client_id, domain_id, email, daily_limit)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [clientId, input.domainId, email, clamp(input.dailyLimit ?? 200, 200, 400)]
  )
}

export async function listIdentities(
  clientId: number,
  domainId: number,
  input: PaginationInput = {}
) {
  const { page, limit, offset } = getSafePage(input)
  const [rows, count] = await Promise.all([
    query<Identity>(
      `SELECT *
       FROM identities
       WHERE client_id = $1 AND domain_id = $2
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [clientId, domainId, limit, offset]
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM identities
       WHERE client_id = $1 AND domain_id = $2`,
      [clientId, domainId]
    ),
  ])

  return createPaginatedResponse(
    rows.rows,
    Number(count?.count ?? 0),
    page,
    limit
  )
}

export async function recalculateDomainHealth(
  clientId: number,
  domainId: number
): Promise<Domain | null> {
  const domain = await queryOne<Domain>(
    `SELECT *
     FROM domains
     WHERE client_id = $1 AND id = $2`,
    [clientId, domainId]
  )

  if (!domain) {
    return null
  }

  const bounceRate =
    domain.sent_count > 0
      ? Number(((domain.bounce_count / domain.sent_count) * 100).toFixed(2))
      : 0
  const healthScore = clamp(Math.round(100 - bounceRate * 8), 0, 100)
  const nextStatus = bounceRate > 5 ? 'paused' : domain.status

  return queryOne<Domain>(
    `UPDATE domains
     SET bounce_rate = $3,
         health_score = $4,
         status = $5,
         updated_at = CURRENT_TIMESTAMP
     WHERE client_id = $1 AND id = $2
     RETURNING *`,
    [clientId, domainId, bounceRate, healthScore, nextStatus]
  )
}

export async function listEvents(
  clientId: number,
  input: PaginationInput & {
    eventType?: EventType
    campaignId?: number
    identityId?: number
  } = {}
) {
  const { page, limit, offset } = getSafePage(input)
  const params: unknown[] = [clientId]
  const filters = ['e.client_id = $1']

  if (input.eventType) {
    params.push(input.eventType)
    filters.push(`e.event_type = $${params.length}`)
  }

  if (input.campaignId) {
    params.push(input.campaignId)
    filters.push(`e.campaign_id = $${params.length}`)
  }

  if (input.identityId) {
    params.push(input.identityId)
    filters.push(`e.identity_id = $${params.length}`)
  }

  params.push(limit, offset)
  const where = filters.join(' AND ')

  const [rows, count] = await Promise.all([
    query<Event>(
      `SELECT e.*
       FROM events e
       WHERE ${where}
       ORDER BY e.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM events e
       WHERE ${where}`,
      params.slice(0, params.length - 2)
    ),
  ])

  return createPaginatedResponse(
    rows.rows,
    Number(count?.count ?? 0),
    page,
    limit
  )
}

export async function createEvent(
  clientId: number,
  input: {
    eventType: EventType
    campaignId?: number | null
    contactId?: number | null
    identityId?: number | null
    domainId?: number | null
    queueJobId?: number | null
    providerMessageId?: string | null
    metadata?: Record<string, unknown> | null
  }
) {
  let replyClassification:
    | 'unread'
    | 'interested'
    | 'not_interested'
    | 'ooo'
    | undefined
  let replyStatus: 'unread' | 'interested' | 'not_interested' | undefined

  if (input.eventType === 'reply') {
    const replyText = String(input.metadata?.body ?? input.metadata?.text ?? '')
    const classified =
      appEnv.openRouterApiKey() ? await classifyReplyWithAi(replyText) : classifyReplyText(replyText)
    replyClassification = classified
    replyStatus =
      classified === 'interested'
        ? 'interested'
        : classified === 'not_interested'
        ? 'not_interested'
        : 'unread'
  }

  const event = await transaction(async (executor) => {
    const inserted = await executor<Event>(
      `INSERT INTO events (
        client_id,
        campaign_id,
        contact_id,
        identity_id,
        domain_id,
        queue_job_id,
        event_type,
        provider_message_id,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        clientId,
        input.campaignId ?? null,
        input.contactId ?? null,
        input.identityId ?? null,
        input.domainId ?? null,
        input.queueJobId ?? null,
        input.eventType,
        input.providerMessageId ?? null,
        input.eventType === 'reply'
          ? {
              ...(input.metadata ?? {}),
              reply_status: replyStatus ?? 'unread',
              classification: replyClassification ?? 'unread',
            }
          : input.metadata ?? null,
      ]
    )

    const created = firstRow(inserted)
    if (!created) {
      throw new Error('Failed to create event')
    }

    if (input.contactId && input.eventType === 'reply') {
      await executor(
        `UPDATE contacts
         SET status = 'replied', updated_at = CURRENT_TIMESTAMP
         WHERE client_id = $1 AND id = $2`,
        [clientId, input.contactId]
      )
    }

    if (input.contactId && input.eventType === 'bounce') {
      await executor(
        `UPDATE contacts
         SET status = 'bounced',
             bounced_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE client_id = $1 AND id = $2`,
        [clientId, input.contactId]
      )
    }

    if (
      input.contactId &&
      (input.eventType === 'unsubscribed' || input.eventType === 'complaint')
    ) {
      await executor(
        `UPDATE contacts
         SET status = 'unsubscribed',
             unsubscribed_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE client_id = $1 AND id = $2`,
        [clientId, input.contactId]
      )
    }

    if (input.contactId && input.eventType === 'bounce') {
      const contact = await executor<Contact>(
        `SELECT *
         FROM contacts
         WHERE client_id = $1 AND id = $2`,
        [clientId, input.contactId]
      )
      const row = firstRow(contact)
      if (row) {
        await insertSuppressionIfNeeded(
          executor,
          clientId,
          row.email,
          'bounced',
          'event:bounce'
        )
      }
    }

    if (
      input.contactId &&
      (input.eventType === 'unsubscribed' || input.eventType === 'complaint')
    ) {
      const contact = await executor<Contact>(
        `SELECT *
         FROM contacts
         WHERE client_id = $1 AND id = $2`,
        [clientId, input.contactId]
      )
      const row = firstRow(contact)
      if (row) {
        await insertSuppressionIfNeeded(
          executor,
          clientId,
          row.email,
          input.eventType === 'complaint' ? 'complaint' : 'unsubscribed',
          `event:${input.eventType}`
        )
      }
    }

    if (input.campaignId && input.eventType === 'reply') {
      await executor(
        `UPDATE campaigns
         SET reply_count = reply_count + 1,
             active_lead_count = active_lead_count + CASE
               WHEN $3 = 'interested' THEN 1
               ELSE 0
             END,
             updated_at = CURRENT_TIMESTAMP
         WHERE client_id = $1 AND id = $2`,
        [clientId, input.campaignId, replyClassification]
      )
    }

    if (input.campaignId && input.eventType === 'opened') {
      await executor(
        `UPDATE campaigns
         SET open_count = open_count + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE client_id = $1 AND id = $2`,
        [clientId, input.campaignId]
      )
    }

    if (input.campaignId && input.eventType === 'bounce') {
      await executor(
        `UPDATE campaigns
         SET bounce_count = bounce_count + 1, updated_at = CURRENT_TIMESTAMP
         WHERE client_id = $1 AND id = $2`,
        [clientId, input.campaignId]
      )
    }

    if (input.domainId && input.eventType === 'bounce') {
      await executor(
        `UPDATE domains
         SET bounce_count = bounce_count + 1, updated_at = CURRENT_TIMESTAMP
         WHERE client_id = $1 AND id = $2`,
        [clientId, input.domainId]
      )
    }

    return created
  })

  if (input.eventType === 'reply') {
    await logOperatorAction({
      clientId,
      campaignId: input.campaignId ?? null,
      actionType: 'reply_classified',
      summary: `Reply classified as ${replyClassification ?? 'unread'}`,
      payload: {
        contactId: input.contactId ?? null,
      },
    })
  }

  if (input.domainId && input.eventType === 'bounce') {
    await recalculateDomainHealth(clientId, input.domainId)
  }

  return event
}

export async function listReplies(clientId: number, input: PaginationInput = {}) {
  const { page, limit, offset } = getSafePage(input)
  const [rows, count] = await Promise.all([
    query<any>(
      `SELECT
         e.id,
         e.campaign_id,
         e.contact_id,
         e.created_at AS date,
         c.email AS from_email,
         COALESCE(c.name, e.metadata->>'from_name', c.email) AS from_name,
         COALESCE(e.metadata->>'subject', 'Reply received') AS subject,
         COALESCE(e.metadata->>'reply_status', 'unread') AS status,
         e.metadata
       FROM events e
       LEFT JOIN contacts c ON c.id = e.contact_id
       WHERE e.client_id = $1
         AND e.event_type = 'reply'
       ORDER BY e.created_at DESC
       LIMIT $2 OFFSET $3`,
      [clientId, limit, offset]
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM events
       WHERE client_id = $1
         AND event_type = 'reply'`,
      [clientId]
    ),
  ])

  return createPaginatedResponse(rows.rows, Number(count?.count ?? 0), page, limit)
}

export async function getReply(clientId: number, replyId: number) {
  return queryOne<any>(
    `SELECT
       e.id,
       e.campaign_id,
       e.contact_id,
       e.created_at AS date,
       c.email AS from_email,
       COALESCE(c.name, e.metadata->>'from_name', c.email) AS from_name,
       COALESCE(e.metadata->>'subject', 'Reply received') AS subject,
       COALESCE(e.metadata->>'reply_status', 'unread') AS status,
       e.metadata
     FROM events e
     LEFT JOIN contacts c ON c.id = e.contact_id
     WHERE e.client_id = $1
       AND e.event_type = 'reply'
       AND e.id = $2`,
    [clientId, replyId]
  )
}

export async function updateReplyStatus(
  clientId: number,
  replyId: number,
  status: 'unread' | 'interested' | 'not_interested'
) {
  return queryOne<Event>(
    `UPDATE events
     SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('reply_status', $3)
     WHERE client_id = $1 AND id = $2 AND event_type = 'reply'
     RETURNING *`,
    [clientId, replyId, status]
  )
}

export async function getAnalytics(clientId: number) {
  const rows = await query<CampaignRow>(
    `SELECT
       c.*,
       s.name AS sequence_name
     FROM campaigns c
     JOIN sequences s ON s.id = c.sequence_id
     WHERE c.client_id = $1
     ORDER BY c.created_at DESC`,
    [clientId]
  )

  return rows.rows.map((campaign) => ({
    campaignName: campaign.name,
    repliesCount: campaign.reply_count,
    replyRate:
      campaign.sent_count > 0
        ? Math.round((campaign.reply_count / campaign.sent_count) * 100)
        : 0,
    bounceRate:
      campaign.sent_count > 0
        ? Number(((campaign.bounce_count / campaign.sent_count) * 100).toFixed(2))
        : 0,
    openRate:
      campaign.sent_count > 0
        ? Number(((campaign.open_count / campaign.sent_count) * 100).toFixed(2))
        : 0,
    sentCount: campaign.sent_count,
  }))
}

export async function getDashboardStats(clientId: number) {
  const [todaySent, replies, campaigns] = await Promise.all([
    queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM events
       WHERE client_id = $1
         AND event_type = 'sent'
         AND created_at >= CURRENT_DATE`,
      [clientId]
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM events
       WHERE client_id = $1
         AND event_type = 'reply'`,
      [clientId]
    ),
    query<Campaign>(
      `SELECT *
       FROM campaigns
       WHERE client_id = $1`,
      [clientId]
    ),
  ])

  const sentTotal = campaigns.rows.reduce((sum, campaign) => sum + campaign.sent_count, 0)
  const openTotal = campaigns.rows.reduce((sum, campaign) => sum + campaign.open_count, 0)
  const bounceTotal = campaigns.rows.reduce((sum, campaign) => sum + campaign.bounce_count, 0)

  return {
    emailsSentToday: Number(todaySent?.count ?? 0),
    replies: Number(replies?.count ?? 0),
    openRate: sentTotal > 0 ? Math.round((openTotal / sentTotal) * 100) : 0,
    bounceRate: sentTotal > 0 ? Math.round((bounceTotal / sentTotal) * 100) : 0,
  }
}

export async function getChartData(clientId: number) {
  const rows = await query<{ sent: string; day: string }>(
    `SELECT
       TO_CHAR(created_at::date, 'Mon DD') AS day,
       COUNT(*)::text AS sent
     FROM events
     WHERE client_id = $1
       AND event_type = 'sent'
       AND created_at >= CURRENT_DATE - INTERVAL '30 days'
     GROUP BY created_at::date
     ORDER BY created_at::date ASC`,
    [clientId]
  )

  return rows.rows.map((row) => ({
    date: row.day,
    sent: Number(row.sent),
  }))
}

export async function getActivityFeed(clientId: number) {
  const rows = await query<any>(
    `SELECT
       e.id,
       e.event_type,
       e.created_at,
       c.email,
       ca.name AS campaign_name
     FROM events e
     LEFT JOIN contacts c ON c.id = e.contact_id
     LEFT JOIN campaigns ca ON ca.id = e.campaign_id
     WHERE e.client_id = $1
     ORDER BY e.created_at DESC
     LIMIT 25`,
    [clientId]
  )

  return rows.rows.map((row) => ({
    id: row.id,
    type: row.event_type,
    timestamp: row.created_at,
    description: (() => {
      switch (row.event_type) {
        case 'sent':
          return `Email sent to ${row.email ?? 'contact'}`
        case 'reply':
          return `Reply received from ${row.email ?? 'contact'}`
        case 'bounce':
          return `Bounce recorded for ${row.email ?? 'contact'}`
        case 'queued':
          return `Campaign ${row.campaign_name ?? 'campaign'} queued`
        default:
          return `${row.event_type} event recorded`
      }
    })(),
  }))
}

export async function listQueueJobs(
  clientId: number,
  input: PaginationInput & { status?: QueueJobStatus } = {}
) {
  const { page, limit, offset } = getSafePage(input)
  const params: unknown[] = [clientId]
  let where = 'WHERE client_id = $1'

  if (input.status) {
    params.push(input.status)
    where += ` AND status = $${params.length}`
  }

  params.push(limit, offset)
  const [rows, count] = await Promise.all([
    query<QueueJob>(
      `SELECT *
       FROM queue_jobs
       ${where}
       ORDER BY scheduled_at ASC, created_at ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM queue_jobs
       ${where}`,
      params.slice(0, params.length - 2)
    ),
  ])

  return createPaginatedResponse(rows.rows, Number(count?.count ?? 0), page, limit)
}

export async function promoteReadyQueueJobs() {
  return promoteDueQueueJobs(appEnv.queuePromoteBatchSize())
}

export async function popQueuedJob() {
  return popReadyQueueJob()
}

export async function claimQueueJob(queueJobId: number, clientId: number) {
  return queryOne<QueueJob>(
    `UPDATE queue_jobs
     SET status = 'processing',
         reserved_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
       AND client_id = $2
       AND status IN ('pending', 'retry')
       AND scheduled_at <= CURRENT_TIMESTAMP
     RETURNING *`,
    [queueJobId, clientId]
  )
}

export async function loadQueueExecutionContext(
  clientId: number,
  queueJobId: number
) {
  const row = await queryOne<any>(
    `SELECT
       qj.*,
       c.id AS contact_id,
       c.email AS contact_email,
       c.email_domain AS contact_email_domain,
       c.name AS contact_name,
       c.company AS contact_company,
       c.company_domain AS contact_company_domain,
       c.title AS contact_title,
       c.timezone AS contact_timezone,
       c.source AS contact_source,
       c.custom_fields AS contact_custom_fields,
       c.enrichment AS contact_enrichment,
       c.verification_status AS contact_verification_status,
       c.verification_sub_status AS contact_verification_sub_status,
       c.status AS contact_status,
       c.unsubscribed_at,
       c.bounced_at,
       ca.sequence_id,
       ca.status AS campaign_status,
       ca.name AS campaign_name,
       ca.contact_count,
       ca.sent_count,
       ca.reply_count,
       ca.bounce_count,
       ca.open_count,
       ca.angle,
       ca.from_identity_mode,
       ca.timezone_strategy,
       ca.ab_test_enabled,
       ca.daily_target,
       ca.active_lead_count,
       ca.last_enqueued_at,
       ca.created_at AS campaign_created_at,
       ca.updated_at AS campaign_updated_at,
       ss.id AS sequence_step_id,
       ss.step_index,
       ss.day_delay,
       ss.touch_label,
       ss.variant_key,
       ss.recipient_strategy,
       ss.cc_mode,
       ss.subject,
       ss.body
     FROM queue_jobs qj
     JOIN contacts c ON c.id = qj.contact_id
     JOIN campaigns ca ON ca.id = qj.campaign_id
     JOIN sequence_steps ss
       ON ss.sequence_id = ca.sequence_id
      AND ss.step_index = qj.sequence_step
     WHERE qj.client_id = $1
       AND qj.id = $2`,
    [clientId, queueJobId]
  )

  if (!row) {
    return null
  }

  const job: QueueJob = {
    id: row.id,
    client_id: row.client_id,
    contact_id: row.contact_id,
    campaign_id: row.campaign_id,
    sequence_step: row.sequence_step,
    scheduled_at: row.scheduled_at,
    recipient_email: row.recipient_email,
    cc_emails: row.cc_emails,
    metadata: row.metadata ?? {},
    status: row.status,
    attempts: row.attempts,
    max_attempts: row.max_attempts,
    last_error: row.last_error,
    provider_message_id: row.provider_message_id,
    reserved_at: row.reserved_at,
    completed_at: row.completed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }

  const contact: Contact = {
    id: row.contact_id,
    client_id: row.client_id,
    email: row.contact_email,
    email_domain: row.contact_email_domain,
    name: row.contact_name,
    company: row.contact_company,
    company_domain: row.contact_company_domain,
    title: row.contact_title,
    timezone: row.contact_timezone,
    source: row.contact_source,
    custom_fields: row.contact_custom_fields ?? {},
    enrichment: row.contact_enrichment ?? null,
    verification_status: row.contact_verification_status,
    verification_sub_status: row.contact_verification_sub_status,
    status: row.contact_status,
    unsubscribed_at: row.unsubscribed_at,
    bounced_at: row.bounced_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }

  const campaign: Campaign = {
    id: row.campaign_id,
    client_id: row.client_id,
    sequence_id: row.sequence_id,
    name: row.campaign_name,
    status: row.campaign_status,
    contact_count: row.contact_count,
    sent_count: row.sent_count,
    reply_count: row.reply_count,
    bounce_count: row.bounce_count,
    open_count: row.open_count,
    angle: row.angle,
    from_identity_mode: row.from_identity_mode,
    timezone_strategy: row.timezone_strategy,
    ab_test_enabled: row.ab_test_enabled,
    daily_target: row.daily_target,
    active_lead_count: row.active_lead_count,
    last_enqueued_at: row.last_enqueued_at,
    created_at: row.campaign_created_at,
    updated_at: row.campaign_updated_at,
  }

  const sequenceStep: SequenceStep = {
    id: row.sequence_step_id,
    sequence_id: row.sequence_id,
    step_index: row.step_index,
    day_delay: row.day_delay,
    touch_label: row.touch_label,
    variant_key: row.variant_key,
    recipient_strategy: row.recipient_strategy,
    cc_mode: row.cc_mode,
    subject: row.subject,
    body: row.body,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }

  return { job, campaign, contact, sequenceStep } satisfies QueueExecutionContext
}

export async function isSuppressed(clientId: number, email: string) {
  const suppression = await queryOne<{ id: number }>(
    `SELECT id
     FROM suppression_list
     WHERE client_id = $1 AND email = $2`,
    [clientId, normalizeEmail(email)]
  )

  return Boolean(suppression)
}

export async function selectBestIdentity(clientId: number) {
  const row = await queryOne<any>(
    `SELECT
       i.*,
       d.id AS domain_id,
       d.domain,
       d.status AS domain_status,
       d.warmup_stage,
       d.spf_valid,
       d.dkim_valid,
       d.dmarc_valid,
       d.daily_limit AS domain_daily_limit,
       d.sent_today AS domain_sent_today,
       d.sent_count AS domain_sent_count,
       d.bounce_count AS domain_bounce_count,
       d.health_score,
       d.bounce_rate,
       d.last_reset_at,
       d.created_at AS domain_created_at,
       d.updated_at AS domain_updated_at
     FROM identities i
     JOIN domains d ON d.id = i.domain_id
     WHERE i.client_id = $1
       AND i.status = 'active'
       AND d.status = 'active'
       AND i.sent_today < i.daily_limit
       AND d.sent_today < d.daily_limit
     ORDER BY
       (CASE WHEN d.spf_valid AND d.dkim_valid AND d.dmarc_valid THEN 1 ELSE 0 END) DESC,
       d.health_score DESC,
       i.last_sent_at ASC NULLS FIRST,
       i.id ASC
     LIMIT 1`,
    [clientId]
  )

  if (!row) {
    return null
  }

  return {
    identity: {
      id: row.id,
      client_id: row.client_id,
      domain_id: row.domain_id,
      email: row.email,
      daily_limit: row.daily_limit,
      sent_today: row.sent_today,
      sent_count: row.sent_count,
      last_sent_at: row.last_sent_at,
      status: row.status,
      last_reset_at: row.last_reset_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    } satisfies Identity,
    domain: {
      id: row.domain_id,
      client_id: row.client_id,
      domain: row.domain,
      status: row.domain_status,
      warmup_stage: row.warmup_stage,
      spf_valid: row.spf_valid,
      dkim_valid: row.dkim_valid,
      dmarc_valid: row.dmarc_valid,
      daily_limit: row.domain_daily_limit,
      sent_today: row.domain_sent_today,
      sent_count: row.domain_sent_count,
      bounce_count: row.domain_bounce_count,
      health_score: row.health_score,
      bounce_rate: row.bounce_rate,
      last_reset_at: row.last_reset_at,
      created_at: row.domain_created_at,
      updated_at: row.domain_updated_at,
    } satisfies Domain,
  } satisfies SendIdentitySelection
}

export function getRandomSendDelaySeconds() {
  const min = appEnv.minSendDelaySeconds()
  const max = Math.max(min, appEnv.maxSendDelaySeconds())
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export async function markQueueJobCompleted(
  context: QueueExecutionContext,
  selection: SendIdentitySelection,
  providerMessageId: string | null
) {
  await transaction(async (executor) => {
    await executor(
      `UPDATE queue_jobs
       SET status = 'completed',
           completed_at = CURRENT_TIMESTAMP,
           provider_message_id = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1 AND id = $2`,
      [context.job.client_id, context.job.id, providerMessageId]
    )

    await executor(
      `UPDATE identities
       SET sent_today = sent_today + 1,
           sent_count = sent_count + 1,
           last_sent_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1 AND id = $2`,
      [context.job.client_id, selection.identity.id]
    )

    await executor(
      `UPDATE domains
       SET sent_today = sent_today + 1,
           sent_count = sent_count + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1 AND id = $2`,
      [context.job.client_id, selection.domain.id]
    )

    await executor(
      `UPDATE campaigns
       SET sent_count = sent_count + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1 AND id = $2`,
      [context.job.client_id, context.campaign.id]
    )

    await executor(
      `INSERT INTO events (
        client_id,
        campaign_id,
        contact_id,
        identity_id,
        domain_id,
        queue_job_id,
        event_type,
        provider_message_id,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'sent', $7, $8)`,
      [
        context.job.client_id,
        context.campaign.id,
        context.contact.id,
        selection.identity.id,
        selection.domain.id,
        context.job.id,
        providerMessageId,
        {
          subject: renderTemplate(context.sequenceStep.subject, context.contact),
          sequence_step: context.sequenceStep.step_index,
        },
      ]
    )
  })

  await recalculateDomainHealth(context.job.client_id, selection.domain.id)
}

export async function markQueueJobSkipped(
  context: QueueExecutionContext,
  reason: string
) {
  await transaction(async (executor) => {
    await executor(
      `UPDATE queue_jobs
       SET status = 'skipped',
           last_error = $3,
           completed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1 AND id = $2`,
      [context.job.client_id, context.job.id, reason]
    )

    await executor(
      `INSERT INTO events (
        client_id,
        campaign_id,
        contact_id,
        queue_job_id,
        event_type,
        metadata
      )
      VALUES ($1, $2, $3, $4, 'skipped', $5)`,
      [
        context.job.client_id,
        context.campaign.id,
        context.contact.id,
        context.job.id,
        { reason, sequence_step: context.sequenceStep.step_index },
      ]
    )
  })
}

export async function markQueueJobFailed(
  context: QueueExecutionContext,
  errorMessage: string
) {
  const nextAttempt = context.job.attempts + 1
  if (nextAttempt < context.job.max_attempts) {
    const retryDelaySeconds = 60 * 2 ** Math.max(context.job.attempts, 0)
    const scheduledAt = new Date(Date.now() + retryDelaySeconds * 1000)

    await query(
      `UPDATE queue_jobs
       SET status = 'retry',
           attempts = attempts + 1,
           last_error = $3,
           scheduled_at = $4,
           updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1 AND id = $2`,
      [context.job.client_id, context.job.id, errorMessage, scheduledAt.toISOString()]
    )

    await enqueueQueueJob({
      ...toQueuePayload(context.job),
      scheduled_at: scheduledAt.toISOString(),
    })

    await query(
      `INSERT INTO events (
        client_id,
        campaign_id,
        contact_id,
        queue_job_id,
        event_type,
        metadata
      )
      VALUES ($1, $2, $3, $4, 'retry', $5)`,
      [
        context.job.client_id,
        context.campaign.id,
        context.contact.id,
        context.job.id,
        { error: errorMessage, attempt: nextAttempt },
      ]
    )

    return 'retry'
  }

  await query(
    `UPDATE queue_jobs
     SET status = 'failed',
         attempts = attempts + 1,
         last_error = $3,
         completed_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE client_id = $1 AND id = $2`,
    [context.job.client_id, context.job.id, errorMessage]
  )

  await query(
    `INSERT INTO events (
      client_id,
      campaign_id,
      contact_id,
      queue_job_id,
      event_type,
      metadata
    )
    VALUES ($1, $2, $3, $4, 'failed', $5)`,
    [
      context.job.client_id,
      context.campaign.id,
      context.contact.id,
      context.job.id,
      { error: errorMessage, attempt: nextAttempt },
    ]
  )

  return 'failed'
}

export async function deferQueueJob(
  context: QueueExecutionContext,
  scheduledAt: Date,
  reason: string
) {
  await query(
    `UPDATE queue_jobs
     SET status = 'retry',
         last_error = $3,
         scheduled_at = $4,
         updated_at = CURRENT_TIMESTAMP
     WHERE client_id = $1 AND id = $2`,
    [context.job.client_id, context.job.id, reason, scheduledAt.toISOString()]
  )

  await requeueQueueJob(toQueuePayload(context.job), scheduledAt)
}

export async function runDailyMaintenance(clientId?: number) {
  const params: unknown[] = []
  let where = ''

  if (clientId) {
    params.push(clientId)
    where = 'WHERE client_id = $1'
  }

  await query(
    `UPDATE identities
     SET sent_today = 0,
         last_reset_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     ${where}`,
    params
  )

  await query(
    `UPDATE domains
     SET sent_today = 0,
         last_reset_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     ${where}`,
    params
  )

  const domains = await query<Domain>(
    `SELECT *
     FROM domains
     ${where}`,
    params
  )

  for (const domain of domains.rows) {
    const identityCountRow = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM identities
       WHERE client_id = $1
         AND domain_id = $2
         AND status = 'active'`,
      [domain.client_id, domain.id]
    )

    const identityCount = Math.max(Number(identityCountRow?.count ?? 0), 1)
    const warmupMultiplier = Math.min(Math.max(Number(domain.warmup_stage ?? 1), 1), 8)
    const perIdentityLimit = Math.min(
      domain.health_score >= 90 ? 400 : domain.health_score >= 75 ? 300 : 200,
      warmupMultiplier * 50
    )

    await query(
      `UPDATE domains
       SET daily_limit = $3,
           warmup_stage = CASE
             WHEN status = 'warming' AND bounce_rate <= 2 THEN LEAST(warmup_stage + 1, 8)
             ELSE warmup_stage
           END,
           status = CASE
             WHEN NOT (spf_valid AND dkim_valid AND dmarc_valid) THEN 'paused'
             WHEN bounce_rate > 5 THEN 'paused'
             WHEN status = 'paused' AND bounce_rate <= 5 THEN 'active'
             ELSE status
           END,
           updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1 AND id = $2`,
      [domain.client_id, domain.id, identityCount * perIdentityLimit]
    )

    await recalculateDomainHealth(domain.client_id, domain.id)
  }

  return { domainsProcessed: domains.rowCount }
}

export async function buildSendMessage(context: QueueExecutionContext) {
  validateSequenceStepCopy(context.sequenceStep)

  const personalized = await buildPersonalizedMessage({
    contact: context.contact,
    step: context.sequenceStep,
  })
  const unsubscribeUrl = buildUnsubscribeUrl({
    clientId: context.job.client_id,
    contactId: context.contact.id,
    campaignId: context.campaign.id,
  })

  const footer = `\n\nUnsubscribe: ${unsubscribeUrl}`
  const text = `${personalized.text}${footer}`.trim()

  return {
    subject: personalized.subject,
    html: text.replaceAll('\n', '<br />'),
    text,
    spamFlags: personalized.spamFlags,
    unsubscribeUrl,
  }
}

export function getNextBusinessWindow(timezone: string | null | undefined, now = new Date()) {
  if (isBusinessHourForTimezone(timezone, now)) {
    return null
  }

  if (!timezone) {
    return new Date(now.getTime() + 60 * 60 * 1000)
  }

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    const parts = Object.fromEntries(
      formatter.formatToParts(now).map((part) => [part.type, part.value])
    )
    const year = Number(parts.year)
    const month = Number(parts.month)
    const day = Number(parts.day)
    const hour = Number(parts.hour)

    const targetDayOffset = hour < 8 ? 0 : 1
    const target = new Date(Date.UTC(year, month - 1, day + targetDayOffset, 8, 0, 0))
    return new Date(target.getTime())
  } catch {
    return new Date(now.getTime() + 60 * 60 * 1000)
  }
}

export async function storeWebhookEvent(input: {
  provider: string
  externalId: string
  eventType: string
  payload: Record<string, unknown>
}) {
  return queryOne<WebhookEvent>(
    `INSERT INTO webhook_events (provider, external_id, event_type, payload)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (provider, external_id) DO NOTHING
     RETURNING *`,
    [input.provider, input.externalId, input.eventType, input.payload]
  )
}

function mapResendEventType(type: string): EventType | null {
  switch (type) {
    case 'email.sent':
      return 'sent'
    case 'email.delivered':
      return 'delivered'
    case 'email.opened':
      return 'opened'
    case 'email.clicked':
      return 'clicked'
    case 'email.bounced':
      return 'bounce'
    case 'email.complained':
      return 'complaint'
    case 'email.failed':
      return 'failed'
    case 'email.replied':
    case 'email.received':
      return 'reply'
    default:
      return null
  }
}

export async function handleResendWebhook(payload: Record<string, unknown>, externalId: string) {
  const type = String(payload.type ?? '')
  const normalizedType = mapResendEventType(type)
  const stored = await storeWebhookEvent({
    provider: 'resend',
    externalId,
    eventType: type,
    payload,
  })

  if (!stored || !normalizedType) {
    return { handled: Boolean(stored), skipped: true }
  }

  const data = (payload.data ?? {}) as Record<string, unknown>
  const providerMessageId = String(
    data.email_id ?? data.id ?? data.emailId ?? data.object_id ?? ''
  ).trim()

  if (!providerMessageId) {
    return { handled: true, skipped: true }
  }

  const linked = await findContactByProviderMessageId(providerMessageId)
  if (!linked) {
    return { handled: true, skipped: true }
  }

  await createEvent(linked.client_id, {
    eventType: normalizedType,
    campaignId: linked.campaign_id,
    contactId: linked.contact_id,
    identityId: linked.identity_id,
    domainId: linked.domain_id,
    queueJobId: linked.queue_job_id,
    providerMessageId,
    metadata: {
      provider: 'resend',
      webhook_type: type,
      ...(data as Record<string, unknown>),
    },
  })

  return { handled: true, skipped: false }
}

export async function unsubscribeContactFromToken(token: string) {
  const parsed = parseUnsubscribeToken(token)
  return markContactUnsubscribed({
    clientId: parsed.clientId,
    contactId: parsed.contactId,
    reason: 'unsubscribe_link',
    source: 'unsubscribe_link',
  })
}

export async function createClientMember(input: {
  clientId: number
  email: string
  name?: string | null
  role: MembershipRole
}) {
  const user = await upsertUser({
    email: input.email,
    name: input.name,
  })

  if (!user) {
    throw new Error('Failed to create user')
  }

  const membership = await assignUserToClient({
    clientId: input.clientId,
    userId: user.id,
    role: input.role,
  })

  return { user, membership }
}

export async function listClientMembers(clientId: number) {
  const result = await listClientUsers(clientId)
  return result.rows
}
