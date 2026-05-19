import type { ContactInput } from './backend'

export type MapsLeadRejected = {
  row: number
  email: string
  reason: string
}

export type PreparedMapsLeadImport = {
  contacts: ContactInput[]
  rejected: MapsLeadRejected[]
  summary: {
    rows: number
    valid: number
    rejected: number
    evidenceBacked: number
  }
}

export type MapsLeadItem = Record<string, unknown>

type ApifyDatasetSummary = {
  id?: string
  name?: string
  itemCount?: number
  modifiedAt?: string
  createdAt?: string
}

export type ResolvedApifyMapsItems = {
  items: MapsLeadItem[]
  sourceType: 'apify_dataset' | 'apify_task'
  sourceUrl: string
  datasetId?: string
  taskId?: string
}

const PERSONAL_EMAIL_DOMAINS = new Set([
  'aol.com',
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'mail.com',
  'msn.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'yahoo.com',
  'yandex.com',
])

const BLOCKED_MAILBOX_PREFIXES = new Set([
  'abuse',
  'admin',
  'billing',
  'career',
  'careers',
  'compliance',
  'donotreply',
  'finance',
  'hr',
  'invoice',
  'invoices',
  'jobs',
  'legal',
  'no-reply',
  'noreply',
  'postmaster',
  'privacy',
  'security',
  'support',
  'webmaster',
])

const SAFE_BUSINESS_MAILBOX_PREFIXES = new Set([
  'bd',
  'business',
  'contact',
  'growth',
  'hello',
  'hi',
  'info',
  'inquiries',
  'inquiry',
  'mail',
  'marketing',
  'opportunities',
  'opportunity',
  'partners',
  'partnership',
  'partnerships',
  'sales',
  'team',
])

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => asStringArray(item))
      .map((item) => item.trim())
      .filter(Boolean)
  }

  const text = asString(value)
  if (!text) return []

  return text
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('?')[0]
}

function cleanUrl(value: unknown): string {
  const text = asString(value)
  if (!text || /^\[.*\]$/.test(text)) return ''
  if (!/^https?:\/\//i.test(text)) return ''
  return text
}

function hostnameFromUrl(value: string): string {
  try {
    return normalizeDomain(new URL(value).hostname)
  } catch {
    return normalizeDomain(value)
  }
}

function domainsAlign(emailDomain: string, websiteDomain: string): boolean {
  if (!emailDomain || !websiteDomain) return false
  if (emailDomain === websiteDomain) return true
  return emailDomain.endsWith(`.${websiteDomain}`) || websiteDomain.endsWith(`.${emailDomain}`)
}

function blockedReason(email: string): string | null {
  if (!isEmail(email)) return 'invalid_email'

  const [prefix, domain] = email.toLowerCase().split('@')
  if (!domain || domain === 'example.com' || domain === 'example.org' || domain.endsWith('.test')) {
    return 'placeholder_or_test_domain'
  }

  if (PERSONAL_EMAIL_DOMAINS.has(domain)) return 'personal_email_domain'
  if (BLOCKED_MAILBOX_PREFIXES.has(prefix)) return 'blocked_mailbox_prefix'
  if (prefix.includes('+')) return 'tagged_or_test_address'

  return null
}

function pickFirst(input: MapsLeadItem, keys: string[]): string {
  for (const key of keys) {
    const value = asString(input[key])
    if (value) return value
  }
  return ''
}

function collectEmails(input: MapsLeadItem): string[] {
  const emails = [
    ...asStringArray(input.email),
    ...asStringArray(input.emails),
    ...asStringArray(input.emailAddress),
    ...asStringArray(input.email_addresses),
    ...asStringArray(input.contactEmails),
  ]

  return Array.from(new Set(emails.map((email) => email.toLowerCase()).filter(Boolean)))
}

function categoryText(input: MapsLeadItem): string {
  return [
    asString(input.categoryName),
    asString(input.category),
    ...asStringArray(input.categories),
    ...asStringArray(input.additionalCategories),
  ]
    .filter(Boolean)
    .join(', ')
}

function fitScoreFor(input: {
  mailbox: string
  categories: string
  industry?: string
  hasAlignedWebsite: boolean
}): number {
  let score = input.hasAlignedWebsite ? 82 : 68
  if (SAFE_BUSINESS_MAILBOX_PREFIXES.has(input.mailbox)) score += 8
  if (input.categories && /agency|marketing|sales|revenue|saas|software|consult/i.test(input.categories)) {
    score += 6
  }
  if (input.industry && input.categories.toLowerCase().includes(input.industry.toLowerCase())) {
    score += 4
  }
  return Math.max(50, Math.min(score, 98))
}

export function prepareMapsLeadContacts(
  items: MapsLeadItem[],
  opts?: {
    sourceUrl?: string
    sourceName?: string
    limit?: number
    dedupeByDomain?: boolean
    industry?: string
    region?: string
  }
): PreparedMapsLeadImport {
  const limit = Math.max(1, Math.min(Number(opts?.limit ?? 100), 500))
  const contacts: ContactInput[] = []
  const rejected: MapsLeadRejected[] = []
  const seenEmails = new Set<string>()
  const seenDomains = new Set<string>()
  const sourceName = opts?.sourceName || 'google_maps_scraper_export'

  for (const [index, item] of items.entries()) {
    if (contacts.length >= limit) break

    const row = index + 1
    const emails = collectEmails(item)
    if (emails.length === 0) {
      rejected.push({ row, email: '', reason: 'missing_email' })
      continue
    }

    const company = pickFirst(item, ['title', 'name', 'company', 'businessName']) || 'Unknown business'
    const website = cleanUrl(item.website || item.urlWebsite || item.companyWebsite)
    const placeUrl = cleanUrl(item.url || item.placeUrl || item.googleMapsUrl)
    const evidenceUrl = website || placeUrl
    const websiteDomain = website ? hostnameFromUrl(website) : ''
    const categories = categoryText(item)

    for (const email of emails) {
      if (contacts.length >= limit) break

      const reason = blockedReason(email)
      if (reason) {
        rejected.push({ row, email, reason })
        continue
      }

      if (!evidenceUrl) {
        rejected.push({ row, email, reason: 'missing_public_evidence_url' })
        continue
      }

      if (seenEmails.has(email)) {
        rejected.push({ row, email, reason: 'duplicate_email' })
        continue
      }

      const [mailbox = '', emailDomain = ''] = email.split('@')
      const companyDomain = websiteDomain || emailDomain
      const alignedWebsite = websiteDomain ? domainsAlign(emailDomain, websiteDomain) : false

      if (websiteDomain && !alignedWebsite) {
        rejected.push({ row, email, reason: 'email_domain_mismatch' })
        continue
      }

      if (opts?.dedupeByDomain && seenDomains.has(emailDomain)) {
        rejected.push({ row, email, reason: 'duplicate_domain' })
        continue
      }

      seenEmails.add(email)
      seenDomains.add(emailDomain)

      const fitScore = fitScoreFor({
        mailbox,
        categories,
        industry: opts?.industry,
        hasAlignedWebsite: alignedWebsite,
      })
      const reasonToContact = `${company} appears relevant to ${opts?.industry || 'outbound'} infrastructure based on public business listing signals${categories ? ` (${categories})` : ''}.`

      contacts.push({
        email,
        company,
        companyDomain,
        title: categories || 'business team',
        source: 'google_maps_apify',
        customFields: {
          maps_import: true,
          data_source: sourceName,
          source_url: opts?.sourceUrl ?? null,
          consent_source: sourceName,
          public_evidence_url: evidenceUrl,
          research_evidence_url: evidenceUrl,
          maps_place_url: placeUrl || null,
          maps_website: website || null,
          maps_phone: pickFirst(item, ['phone', 'phoneUnformatted', 'phoneNumber']) || null,
          maps_address: pickFirst(item, ['address', 'street', 'fullAddress']) || null,
          maps_category: categories || null,
          maps_region: opts?.region || null,
          fit_score: fitScore,
          confidence: alignedWebsite ? 'high' : 'medium',
          reason_to_contact: reasonToContact,
          send_status: 'not_approved',
          approval_required: true,
          auto_approval_eligible: Boolean(evidenceUrl && (!websiteDomain || alignedWebsite)),
          email_evidence: alignedWebsite
            ? 'maps_public_business_domain_match'
            : 'maps_public_business_evidence',
        },
      })
    }
  }

  return {
    contacts,
    rejected,
    summary: {
      rows: items.length,
      valid: contacts.length,
      rejected: rejected.length,
      evidenceBacked: contacts.filter((contact) => contact.customFields?.auto_approval_eligible).length,
    },
  }
}

export function buildApifyDatasetItemsUrl(input: {
  datasetId: string
  token: string
  limit?: number
  offset?: number
}): string {
  const limit = Math.max(1, Math.min(Number(input.limit ?? 100), 500))
  const offset = Math.max(0, Math.trunc(Number(input.offset ?? 0) || 0))
  const url = new URL(`https://api.apify.com/v2/datasets/${encodeURIComponent(input.datasetId)}/items`)
  url.searchParams.set('clean', 'true')
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('offset', String(offset))
  url.searchParams.set('token', input.token)
  return url.toString()
}

export function buildApifyDatasetsUrl(input: {
  token: string
  limit?: number
}): string {
  const limit = Math.max(1, Math.min(Number(input.limit ?? 20), 100))
  const url = new URL('https://api.apify.com/v2/datasets')
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('desc', '1')
  url.searchParams.set('unnamed', 'true')
  url.searchParams.set('token', input.token)
  return url.toString()
}

export function buildApifyTaskRunItemsUrl(input: {
  taskId: string
  token: string
  limit?: number
  timeoutSecs?: number
}): string {
  const limit = Math.max(1, Math.min(Number(input.limit ?? 100), 500))
  const timeoutSecs = Math.max(30, Math.min(Number(input.timeoutSecs ?? 120), 300))
  const url = new URL(
    `https://api.apify.com/v2/actor-tasks/${encodeURIComponent(input.taskId)}/run-sync-get-dataset-items`
  )
  url.searchParams.set('clean', 'true')
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('timeout', String(timeoutSecs))
  url.searchParams.set('token', input.token)
  return url.toString()
}

function extractDatasets(data: unknown): ApifyDatasetSummary[] {
  if (Array.isArray(data)) return data as ApifyDatasetSummary[]
  if (
    data &&
    typeof data === 'object' &&
    'data' in data &&
    (data as { data?: unknown }).data &&
    typeof (data as { data?: unknown }).data === 'object'
  ) {
    const nested = (data as { data: { items?: unknown } }).data.items
    if (Array.isArray(nested)) return nested as ApifyDatasetSummary[]
  }
  return []
}

export async function fetchLatestApifyDatasetId(input: {
  token: string
  limit?: number
  fetchImpl?: typeof fetch
}): Promise<string> {
  const fetcher = input.fetchImpl ?? fetch
  const response = await fetcher(buildApifyDatasetsUrl(input), {
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  })

  if (!response.ok) {
    throw new Error(`Apify datasets list returned HTTP ${response.status}`)
  }

  const datasets = extractDatasets(await response.json())
    .filter((dataset) => dataset.id && Number(dataset.itemCount ?? 0) > 0)
    .sort((left, right) => {
      const leftTime = Date.parse(left.modifiedAt || left.createdAt || '')
      const rightTime = Date.parse(right.modifiedAt || right.createdAt || '')
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0)
    })

  const latest = datasets[0]?.id
  if (!latest) {
    throw new Error('No non-empty Apify dataset found. Run the Google Maps scraper once first.')
  }

  return latest
}

export async function fetchApifyTaskDatasetItems(input: {
  taskId: string
  token: string
  limit?: number
  timeoutSecs?: number
  fetchImpl?: typeof fetch
}): Promise<MapsLeadItem[]> {
  const fetcher = input.fetchImpl ?? fetch
  const response = await fetcher(
    buildApifyTaskRunItemsUrl({
      taskId: input.taskId,
      token: input.token,
      limit: input.limit,
      timeoutSecs: input.timeoutSecs,
    }),
    {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(Math.max(35_000, Math.min(Number(input.timeoutSecs ?? 120) * 1000 + 5_000, 305_000))),
    }
  )

  if (!response.ok) {
    throw new Error(`Apify task run returned HTTP ${response.status}`)
  }

  const data = await response.json()
  if (!Array.isArray(data)) {
    throw new Error('Apify task run did not return a dataset item array')
  }

  return data as MapsLeadItem[]
}

export async function fetchApifyDatasetItems(input: {
  datasetId: string
  token: string
  limit?: number
  offset?: number
  fetchImpl?: typeof fetch
}): Promise<MapsLeadItem[]> {
  const fetcher = input.fetchImpl ?? fetch
  const response = await fetcher(
    buildApifyDatasetItemsUrl({
      datasetId: input.datasetId,
      token: input.token,
      limit: input.limit,
      offset: input.offset,
    }),
    {
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    }
  )

  if (!response.ok) {
    throw new Error(`Apify dataset returned HTTP ${response.status}`)
  }

  const data = await response.json()
  if (!Array.isArray(data)) {
    throw new Error('Apify dataset did not return an item array')
  }

  return data as MapsLeadItem[]
}

function isNoDatasetError(error: unknown): boolean {
  return error instanceof Error && /No non-empty Apify dataset found/i.test(error.message)
}

export async function resolveApifyMapsItems(input: {
  token: string
  requestedDatasetId?: string
  taskId?: string
  limit?: number
  offset?: number
  datasetDiscoveryLimit?: number
  taskTimeoutSecs?: number
  fetchImpl?: typeof fetch
}): Promise<ResolvedApifyMapsItems> {
  const datasetId = String(input.requestedDatasetId || '').trim()
  const taskId = String(input.taskId || '').trim()

  if (datasetId) {
    return {
      items: await fetchApifyDatasetItems({
        datasetId,
        token: input.token,
        limit: input.limit,
        offset: input.offset,
        fetchImpl: input.fetchImpl,
      }),
      sourceType: 'apify_dataset',
      sourceUrl: `apify:dataset:${datasetId}`,
      datasetId,
    }
  }

  try {
    const latestDatasetId = await fetchLatestApifyDatasetId({
      token: input.token,
      limit: input.datasetDiscoveryLimit,
      fetchImpl: input.fetchImpl,
    })

    return {
      items: await fetchApifyDatasetItems({
        datasetId: latestDatasetId,
        token: input.token,
        limit: input.limit,
        offset: input.offset,
        fetchImpl: input.fetchImpl,
      }),
      sourceType: 'apify_dataset',
      sourceUrl: `apify:dataset:${latestDatasetId}`,
      datasetId: latestDatasetId,
    }
  } catch (error) {
    if (!isNoDatasetError(error)) throw error
    if (!taskId) {
      throw new Error(
        'No non-empty Apify dataset found and no saved Google Maps task is configured. Set APIFY_GOOGLE_MAPS_TASK_ID in Render or pass taskId= in the cron URL.'
      )
    }
  }

  return {
    items: await fetchApifyTaskDatasetItems({
      taskId,
      token: input.token,
      limit: input.limit,
      timeoutSecs: input.taskTimeoutSecs,
      fetchImpl: input.fetchImpl,
    }),
    sourceType: 'apify_task',
    sourceUrl: `apify:task:${taskId}`,
    taskId,
  }
}
