import crypto from 'node:crypto'
import { getConnectorDefinition, type IngestionSourceType } from '@/lib/ingestion/connector-registry'

export interface NormalizedLeadRecord {
  externalId: string
  payloadHash: string
  email: string
  emailDomain: string
  name?: string
  firstName?: string
  lastName?: string
  title?: string
  company?: string
  companyDomain?: string
  website?: string
  linkedinUrl?: string
  industry?: string
  employeeCount?: number
  source: IngestionSourceType
  customFields: Record<string, unknown>
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = asString(record[key])
    if (value) return value
  }
  return ''
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const raw = record[key]
    const n = typeof raw === 'number' ? raw : Number.parseInt(asString(raw).replace(/[^\d]/g, ''), 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  return undefined
}

function normalizeDomain(raw: string): string {
  const value = raw.trim().toLowerCase()
  if (!value) return ''
  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`)
    return url.hostname.replace(/^www\./, '')
  } catch {
    return value.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
  }
}

function stableHash(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value, Object.keys(value as object).sort())).digest('hex')
}

export function normalizeSourceRecord(
  source: IngestionSourceType,
  record: Record<string, unknown>
): NormalizedLeadRecord {
  const definition = getConnectorDefinition(source)
  const email = firstString(record, [
    'email',
    'Email',
    'work_email',
    'business_email',
    'contact_email',
    'recipient',
  ]).toLowerCase()

  if (!EMAIL_RE.test(email)) {
    throw new Error('invalid_or_missing_email')
  }

  const website = firstString(record, ['website', 'Website', 'domain', 'company_domain', 'Company Domain'])
  const companyDomain = normalizeDomain(website || email.split('@')[1])
  const externalId =
    firstString(record, definition.idFields) ||
    stableHash({ source, email, companyDomain }).slice(0, 32)

  const firstName = firstString(record, ['first_name', 'firstName', 'First Name'])
  const lastName = firstString(record, ['last_name', 'lastName', 'Last Name'])
  const fullName = firstString(record, ['name', 'Name', 'full_name', 'fullName']) || [firstName, lastName].filter(Boolean).join(' ')

  return {
    externalId,
    payloadHash: stableHash(record),
    email,
    emailDomain: email.split('@')[1],
    name: fullName || undefined,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    title: firstString(record, ['title', 'Title', 'job_title', 'jobTitle', 'position']) || undefined,
    company: firstString(record, ['company', 'Company', 'company_name', 'companyName', 'account_name']) || undefined,
    companyDomain,
    website: website || undefined,
    linkedinUrl: firstString(record, ['linkedin_url', 'linkedinUrl', 'profile_url', 'linkedin']) || undefined,
    industry: firstString(record, ['industry', 'Industry', 'category']) || undefined,
    employeeCount: firstNumber(record, ['employee_count', 'employees', 'company_size', 'employeeCount']),
    source,
    customFields: {
      source_trust: definition.trustScore,
      raw_keys: Object.keys(record).slice(0, 100),
    },
  }
}
