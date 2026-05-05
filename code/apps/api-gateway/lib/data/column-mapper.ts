export type ColumnMapping = {
  email: string
  firstName?: string
  lastName?: string
  name?: string
  company?: string
  title?: string
  timezone?: string
  companyDomain?: string
  source?: string
  // Any remaining columns will be collected into customFields.
}

export type PreviewStats = {
  totalRows: number
  validEmails: number
  invalidEmails: number
  duplicateEmails: number
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normHeader(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
}

function pickHeader(headers: string[], candidates: string[]): string | undefined {
  const normalized = new Map(headers.map((h) => [normHeader(h), h] as const))
  for (const c of candidates) {
    const found = normalized.get(normHeader(c))
    if (found) return found
  }
  return undefined
}

export function suggestColumnMapping(headers: string[]): ColumnMapping | null {
  const email = pickHeader(headers, ['email', 'email_address', 'work_email', 'e_mail'])
  if (!email) return null

  return {
    email,
    firstName: pickHeader(headers, ['first_name', 'firstname', 'first']),
    lastName: pickHeader(headers, ['last_name', 'lastname', 'last']),
    name: pickHeader(headers, ['name', 'full_name', 'fullname']),
    company: pickHeader(headers, ['company', 'company_name', 'organization', 'organisation', 'account', 'employer']),
    title: pickHeader(headers, ['title', 'job_title', 'jobtitle', 'role', 'position']),
    timezone: pickHeader(headers, ['timezone', 'tz', 'time_zone']),
    companyDomain: pickHeader(headers, ['company_domain', 'companydomain', 'domain', 'website', 'company_website']),
    source: pickHeader(headers, ['source']),
  }
}

export function buildPreviewStats(rows: Array<Record<string, unknown>>, mapping: ColumnMapping | null): PreviewStats {
  const seen = new Set<string>()
  let valid = 0
  let invalid = 0
  let dup = 0

  for (const row of rows) {
    const raw = mapping?.email ? String(row[mapping.email] ?? '') : ''
    const email = raw.trim().toLowerCase()
    if (!email) {
      invalid += 1
      continue
    }
    if (!EMAIL_RE.test(email)) {
      invalid += 1
      continue
    }
    if (seen.has(email)) {
      dup += 1
      continue
    }
    seen.add(email)
    valid += 1
  }

  return {
    totalRows: rows.length,
    validEmails: valid,
    invalidEmails: invalid,
    duplicateEmails: dup,
  }
}

export function applyColumnMapping(rows: Array<Record<string, unknown>>, mapping: ColumnMapping, opts?: { sourceOverride?: string }) {
  const reserved = new Set(
    Object.values(mapping)
      .filter(Boolean)
      .map((v) => String(v))
  )

  const contacts = rows.map((row) => {
    const email = String(row[mapping.email] ?? '').trim()
    const first = mapping.firstName ? String(row[mapping.firstName] ?? '').trim() : ''
    const last = mapping.lastName ? String(row[mapping.lastName] ?? '').trim() : ''
    const name =
      (mapping.name ? String(row[mapping.name] ?? '').trim() : '') ||
      [first, last].filter(Boolean).join(' ') ||
      undefined

    const company = mapping.company ? String(row[mapping.company] ?? '').trim() : ''
    const title = mapping.title ? String(row[mapping.title] ?? '').trim() : ''
    const timezone = mapping.timezone ? String(row[mapping.timezone] ?? '').trim() : ''
    const companyDomain = mapping.companyDomain ? String(row[mapping.companyDomain] ?? '').trim() : ''
    const source =
      opts?.sourceOverride ||
      (mapping.source ? String(row[mapping.source] ?? '').trim() : '') ||
      'manual_upload'

    const customFields: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(row)) {
      if (reserved.has(k)) continue
      if (v === null || v === undefined) continue
      const s = String(v).trim()
      if (!s) continue
      customFields[k] = s
    }

    return {
      email,
      name,
      company: company || undefined,
      title: title || undefined,
      timezone: timezone || undefined,
      companyDomain: companyDomain || undefined,
      source,
      customFields,
    }
  })

  return contacts
}

