export type HunterVerdict = 'valid' | 'risky' | 'invalid' | 'unknown'

export interface HunterVerificationResult {
  provider: 'hunter'
  verdict: HunterVerdict
  score: number
  catchAll: boolean
  raw: Record<string, unknown> | null
  error?: string
}

export interface VerifyEmailWithHunterOptions {
  apiKey?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export interface HunterEmailSource {
  domain?: string | null
  uri?: string | null
  extracted_on?: string | null
  last_seen_on?: string | null
  still_on_page?: boolean | null
}

export interface HunterDomainEmail {
  value: string
  type: string | null
  confidence: number
  firstName: string | null
  lastName: string | null
  position: string | null
  seniority: string | null
  department: string | null
  linkedin: string | null
  sources: HunterEmailSource[]
}

export interface HunterDomainSearchResult {
  provider: 'hunter'
  domain: string
  organization: string | null
  pattern: string | null
  acceptAll: boolean
  disposable: boolean
  webmail: boolean
  emails: HunterDomainEmail[]
  raw: Record<string, unknown> | null
  error?: string
}

export interface SearchDomainWithHunterOptions {
  apiKey?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  limit?: number
  offset?: number
}

function clampScore(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0.5
  const normalized = parsed > 1 ? parsed / 100 : parsed
  return Math.max(0, Math.min(1, Number(normalized.toFixed(2))))
}

function clampConfidence(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.min(100, Math.round(parsed)))
}

function asBool(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1'
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNullableString(value: unknown): string | null {
  const text = asString(value)
  return text || null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function normalizeEmailSource(value: unknown): HunterEmailSource {
  const source = asRecord(value)
  return {
    domain: asNullableString(source.domain),
    uri: asNullableString(source.uri),
    extracted_on: asNullableString(source.extracted_on),
    last_seen_on: asNullableString(source.last_seen_on),
    still_on_page:
      typeof source.still_on_page === 'boolean' ? source.still_on_page : null,
  }
}

export function mapHunterDomainSearch(
  payload: Record<string, unknown>,
  fallbackDomain = ''
): Omit<HunterDomainSearchResult, 'provider' | 'raw' | 'error'> {
  const data = asRecord(payload.data ?? payload)
  const emails = Array.isArray(data.emails)
    ? data.emails.map((item) => {
        const row = asRecord(item)
        return {
          value: asString(row.value).toLowerCase(),
          type: asNullableString(row.type),
          confidence: clampConfidence(row.confidence),
          firstName: asNullableString(row.first_name),
          lastName: asNullableString(row.last_name),
          position: asNullableString(row.position),
          seniority: asNullableString(row.seniority),
          department: asNullableString(row.department),
          linkedin: asNullableString(row.linkedin),
          sources: Array.isArray(row.sources)
            ? row.sources.map(normalizeEmailSource)
            : [],
        }
      }).filter((email) => email.value)
    : []

  return {
    domain: asString(data.domain) || fallbackDomain,
    organization: asNullableString(data.organization),
    pattern: asNullableString(data.pattern),
    acceptAll: asBool(data.accept_all ?? data.acceptAll),
    disposable: asBool(data.disposable),
    webmail: asBool(data.webmail),
    emails,
  }
}

export function mapHunterVerification(data: Record<string, unknown>): Omit<HunterVerificationResult, 'provider' | 'raw' | 'error'> {
  const result = String(data.result ?? '').trim().toLowerCase()
  const score = clampScore(data.score)
  const catchAll = asBool(data.accept_all ?? data.acceptAll)

  if (result === 'deliverable') {
    return { verdict: 'valid', score, catchAll }
  }

  if (result === 'undeliverable') {
    return { verdict: 'invalid', score, catchAll }
  }

  if (result === 'risky') {
    return { verdict: 'risky', score, catchAll }
  }

  return { verdict: 'unknown', score, catchAll }
}

export async function verifyEmailWithHunter(
  email: string,
  options?: VerifyEmailWithHunterOptions
): Promise<HunterVerificationResult> {
  const apiKey = String(options?.apiKey ?? process.env.HUNTER_API_KEY ?? '').trim()
  if (!apiKey) {
    return {
      provider: 'hunter',
      verdict: 'unknown',
      score: 0.5,
      catchAll: false,
      raw: null,
      error: 'hunter_not_configured',
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? 8_000)

  try {
    const url = new URL('https://api.hunter.io/v2/email-verifier')
    url.searchParams.set('email', email)
    url.searchParams.set('api_key', apiKey)

    const response = await (options?.fetchImpl ?? fetch)(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })

    if (!response.ok) {
      return {
        provider: 'hunter',
        verdict: 'unknown',
        score: 0.5,
        catchAll: false,
        raw: null,
        error: `hunter_http_${response.status}`,
      }
    }

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null
    const data = payload?.data && typeof payload.data === 'object'
      ? (payload.data as Record<string, unknown>)
      : {}
    const mapped = mapHunterVerification(data)

    return {
      provider: 'hunter',
      ...mapped,
      raw: data,
    }
  } catch (error) {
    return {
      provider: 'hunter',
      verdict: 'unknown',
      score: 0.5,
      catchAll: false,
      raw: null,
      error: error instanceof Error && error.name === 'AbortError'
        ? 'hunter_timeout'
        : 'hunter_request_failed',
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function searchDomainWithHunter(
  domain: string,
  options?: SearchDomainWithHunterOptions
): Promise<HunterDomainSearchResult> {
  const apiKey = String(options?.apiKey ?? process.env.HUNTER_API_KEY ?? '').trim()
  const normalizedDomain = String(domain || '').trim().toLowerCase()
  if (!apiKey) {
    return {
      provider: 'hunter',
      domain: normalizedDomain,
      organization: null,
      pattern: null,
      acceptAll: false,
      disposable: false,
      webmail: false,
      emails: [],
      raw: null,
      error: 'hunter_not_configured',
    }
  }

  if (!normalizedDomain) {
    return {
      provider: 'hunter',
      domain: normalizedDomain,
      organization: null,
      pattern: null,
      acceptAll: false,
      disposable: false,
      webmail: false,
      emails: [],
      raw: null,
      error: 'missing_domain',
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? 10_000)

  try {
    const url = new URL('https://api.hunter.io/v2/domain-search')
    url.searchParams.set('domain', normalizedDomain)
    url.searchParams.set('api_key', apiKey)
    url.searchParams.set('limit', String(Math.max(1, Math.min(Number(options?.limit ?? 10), 100))))
    if (options?.offset) {
      url.searchParams.set('offset', String(Math.max(0, Number(options.offset) || 0)))
    }

    const response = await (options?.fetchImpl ?? fetch)(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })

    if (!response.ok) {
      return {
        provider: 'hunter',
        domain: normalizedDomain,
        organization: null,
        pattern: null,
        acceptAll: false,
        disposable: false,
        webmail: false,
        emails: [],
        raw: null,
        error: `hunter_http_${response.status}`,
      }
    }

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null
    const mapped = mapHunterDomainSearch(payload ?? {}, normalizedDomain)
    return {
      provider: 'hunter',
      ...mapped,
      raw: payload?.data && typeof payload.data === 'object'
        ? (payload.data as Record<string, unknown>)
        : payload,
    }
  } catch (error) {
    return {
      provider: 'hunter',
      domain: normalizedDomain,
      organization: null,
      pattern: null,
      acceptAll: false,
      disposable: false,
      webmail: false,
      emails: [],
      raw: null,
      error: error instanceof Error && error.name === 'AbortError'
        ? 'hunter_timeout'
        : 'hunter_request_failed',
    }
  } finally {
    clearTimeout(timeout)
  }
}
