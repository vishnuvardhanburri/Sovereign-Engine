import type { ContactInput } from '@/lib/backend'
import type { LeadScoutPersona, OpenLead } from '@/lib/lead-scout'

type PublicSearchProvider = 'serpapi' | 'bing_html' | 'duckduckgo_html'

type SerpApiOrganicResult = {
  title?: string
  link?: string
  displayed_link?: string
  snippet?: string
}

type SerpApiResponse = {
  error?: string
  search_metadata?: {
    status?: string
    error?: string
  }
  organic_results?: SerpApiOrganicResult[]
}

type SearchPageResult = {
  results: SerpApiOrganicResult[]
  error?: string
}

export type PublicSearchLeadSearchInput = {
  provider?: PublicSearchProvider
  apiKey?: string
  industry?: string | null
  persona?: string | null
  region?: string | null
  limit?: number
  timeoutMs?: number
  queries?: string[]
}

export type PublicSearchLeadSearchResult = {
  provider: PublicSearchProvider
  industry: string
  persona: LeadScoutPersona
  region: string
  leads: OpenLead[]
  scannedResults: number
  rejected: number
  queriesRun: number
  errors: string[]
  guardrails: string[]
}

const DEFAULT_LIMIT = 250
const MAX_LIMIT = 5_000
const DEFAULT_TIMEOUT_MS = 55_000

const PERSONA_MAILBOXES: Record<LeadScoutPersona, string[]> = {
  founder: ['hello', 'contact', 'team'],
  growth: ['growth', 'marketing', 'hello'],
  partnerships: ['partners', 'partnerships', 'hello'],
  sales: ['sales', 'hello', 'contact'],
  operations: ['operations', 'ops', 'hello'],
}

const BLOCKED_HOSTS = new Set([
  'angel.co',
  'apollo.io',
  'apps.apple.com',
  'builtwith.com',
  'capterra.com',
  'clutch.co',
  'crunchbase.com',
  'facebook.com',
  'github.com',
  'glassdoor.com',
  'google.com',
  'g2.com',
  'coursera.org',
  'edx.org',
  'epicgames.com',
  'geeksforgeeks.org',
  'indeed.com',
  'instagram.com',
  'investopedia.com',
  'javatpoint.com',
  'linkedin.com',
  'medium.com',
  'producthunt.com',
  'reddit.com',
  'saasworthy.com',
  'steampowered.com',
  'techcrunch.com',
  'tutorialspoint.com',
  'twitter.com',
  'udemy.com',
  'wellfound.com',
  'wikily.gg',
  'wikipedia.org',
  'w3schools.com',
  'x.com',
  'xbox.com',
  'yelp.com',
  'youtube.com',
])

const LOW_VALUE_PATH_RE =
  /\b(?:article|blog|careers?|certification|course|developer-docs|docs?|guide|help|intro|introduction|jobs?|learn|legal|login|news|press|pricing|privacy|resources?|signin|signup|support|terms|training|tutorial|what-is)\b/i

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(Math.trunc(parsed), max))
}

function normalizePersona(input?: string | null): LeadScoutPersona {
  const value = String(input || 'founder').trim().toLowerCase()
  if (['founder', 'growth', 'partnerships', 'sales', 'operations'].includes(value)) {
    return value as LeadScoutPersona
  }
  return 'founder'
}

function normalizeIndustry(input?: string | null): string {
  const value = String(input || 'agency').trim().toLowerCase()
  if (!value) return 'agency'
  if (['b2b', 'marketing', 'revops', 'outbound', 'leadgen'].includes(value)) return 'agency'
  if (['security', 'cyber', 'infosec'].includes(value)) return 'cybersecurity'
  if (['developer', 'infrastructure', 'cloud'].includes(value)) return 'devtools'
  return value.replace(/[^a-z0-9 -]/g, '').slice(0, 48) || 'agency'
}

function normalizeRegion(input?: string | null): string {
  return String(input || 'United States').trim() || 'United States'
}

function glForRegion(region: string): string {
  const value = region.toLowerCase()
  if (value.includes('india')) return 'in'
  if (value.includes('united kingdom') || value === 'uk') return 'uk'
  if (value.includes('canada')) return 'ca'
  if (value.includes('australia')) return 'au'
  return 'us'
}

function companyFromTitle(title: string, domain: string): string {
  const cleaned = title
    .split(/\s[|-]\s/)[0]
    .replace(/\b(contact|sales|demo|home|official site|homepage)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned && cleaned.length <= 80) return cleaned

  return domain
    .split('.')[0]
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function isLowIntentSearchResult(result: SerpApiOrganicResult): boolean {
  const text = `${result.title || ''} ${result.snippet || ''} ${result.link || ''}`.toLowerCase()
  const contentSignals =
    /\b(?:article|blog|course|definition|explained|guide|how to|intro|introduction|learn|resources?|training|tutorial|types of|what is)\b/.test(
      text
    )
  const commercialSignals =
    /\b(?:agency|book a demo|clients|contact sales|enterprise|get in touch|managed service|mssp|platform|revops|sales team|services|software|solution|whitepaper)\b/.test(
      text
    )
  return contentSignals && !commercialSignals
}

function normalizeDomainFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    if (!hostname || !hostname.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return null
    const blocked = Array.from(BLOCKED_HOSTS).some((host) => hostname === host || hostname.endsWith(`.${host}`))
    if (blocked) return null
    if (LOW_VALUE_PATH_RE.test(url.pathname)) return null
    return hostname
  } catch {
    return null
  }
}

function mailboxForPersona(domain: string, persona: LeadScoutPersona): string {
  const mailbox = PERSONA_MAILBOXES[persona][0] || 'hello'
  return `${mailbox}@${domain}`
}

function defaultQueries(industry: string, region: string): string[] {
  const queryGroups: Record<string, string[]> = {
    agency: [
      'outbound agency contact B2B',
      'lead generation agency contact B2B',
      'RevOps agency contact sales operations',
      'AI automation agency contact B2B',
      'appointment setting agency contact B2B',
    ],
    cybersecurity: [
      'cybersecurity SaaS contact sales',
      'AI security contact enterprise',
      'MSSP contact managed security',
      'security operations platform contact sales',
    ],
    ai: [
      'AI infrastructure contact sales',
      'LLM infrastructure contact enterprise',
      'AI governance contact sales',
      'private AI contact enterprise',
    ],
    devtools: [
      'developer tools contact sales',
      'cloud infrastructure contact sales',
      'observability platform contact sales',
      'workflow orchestration contact sales',
    ],
    saas: [
      'B2B SaaS contact sales',
      'sales engagement contact sales',
      'revenue operations contact sales',
      'customer engagement platform contact sales peope]',
    ],
  }

  const selected = queryGroups[industry] ?? queryGroups.agency
  return selected.map((query) => `${query} ${region}`)
}

function scoreResult(result: SerpApiOrganicResult, industry: string): number {
  const text = `${result.title || ''} ${result.snippet || ''} ${result.link || ''}`.toLowerCase()
  let score = 42
  if (text.includes(industry)) score += 10
  if (/\b(outbound|lead generation|revops|sales operations|appointment setting|demand generation)\b/i.test(text)) score += 15
  if (/\b(agency|services|clients|b2b|marketing agency|growth agency|consulting|done-for-you)\b/i.test(text)) score += 12
  if (/\b(ai governance|cybersecurity|security operations|infrastructure|observability|compliance|enterprise)\b/i.test(text)) score += 12
  if (/\b(contact sales|book a demo|get in touch|sales team)\b/i.test(text)) score += 8
  if (/\b(blog|news|podcast|article|job|career)\b/i.test(text)) score -= 10
  if (/\b(what is|complete guide|best practices|ultimate guide|resources|learn|definition|introduction|tutorial|course|training|types of|explained)\b/i.test(text)) score -= 36
  return Math.max(0, Math.min(score, 98))
}

async function fetchSerpApiPage(input: {
  apiKey: string
  query: string
  region: string
  start: number
  timeoutMs: number
}): Promise<SearchPageResult> {
  try {
    const url = new URL('https://serpapi.com/search.json')
    url.searchParams.set('engine', 'google')
    url.searchParams.set('q', input.query)
    url.searchParams.set('api_key', input.apiKey)
    url.searchParams.set('hl', 'en')
    url.searchParams.set('gl', glForRegion(input.region))
    url.searchParams.set('location', input.region)
    url.searchParams.set('safe', 'active')
    url.searchParams.set('num', '10')
    url.searchParams.set('start', String(input.start))

    const response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(input.timeoutMs),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      return { results: [], error: `serpapi_http_${response.status}` }
    }
    const body = payload as SerpApiResponse
    return {
      results: body.organic_results ?? [],
      error: body.error || body.search_metadata?.error,
    }
  } catch (error) {
    return { results: [], error: `serpapi_fetch_${error instanceof Error ? error.name : 'error'}` }
  }
}

function decodeBasicHtml(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function stripHtml(input: string): string {
  return decodeBasicHtml(input.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

function normalizeDuckDuckGoLink(rawHref: string): string {
  const decoded = decodeBasicHtml(rawHref)
  try {
    const redirect = new URL(decoded, 'https://duckduckgo.com')
    const uddg = redirect.searchParams.get('uddg')
    return uddg ? decodeURIComponent(uddg) : redirect.toString()
  } catch {
    return decoded
  }
}

function parseDuckDuckGoHtml(html: string): SerpApiOrganicResult[] {
  const anchors = Array.from(
    html.matchAll(/<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)
  )
  const snippets = Array.from(html.matchAll(/<a[^>]+class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi))
    .map((match) => stripHtml(String(match[1] || '')))

  return anchors
    .map((match, index) => {
      const link = normalizeDuckDuckGoLink(String(match[1] || ''))
      return {
        title: stripHtml(String(match[2] || '')),
        link,
        displayed_link: (() => {
          try {
            return new URL(link).hostname
          } catch {
            return ''
          }
        })(),
        snippet: snippets[index] || '',
      }
    })
    .filter((result) => Boolean(result.title && result.link))
}

function decodeBingRedirect(rawHref: string): string {
  const decodedHref = decodeBasicHtml(rawHref)
  try {
    const url = new URL(decodedHref, 'https://www.bing.com')
    const encodedTarget = url.searchParams.get('u')
    if (!encodedTarget) return url.toString()

    const payload = encodedTarget.startsWith('a1') ? encodedTarget.slice(2) : encodedTarget
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
    const target = Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8')
    return target || url.toString()
  } catch {
    return decodedHref
  }
}

function parseBingHtml(html: string): SerpApiOrganicResult[] {
  const blocks = html.match(/<li class=["']b_algo["'][\s\S]*?(?=<li class=["']b_algo["']|<li class=["']b_pag["']|<\/ol>)/gi) ?? []
  const results: SerpApiOrganicResult[] = []

  for (const block of blocks) {
    const titleMatch = block.match(/<h2[^>]*>\s*<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h2>/i)
    if (!titleMatch) continue

    const link = decodeBingRedirect(String(titleMatch[1] || ''))
    const title = stripHtml(String(titleMatch[2] || ''))
    if (!title || !link) continue

    const snippet = stripHtml(String(block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] || ''))
    results.push({
      title,
      link,
      displayed_link: (() => {
        try {
          return new URL(link).hostname
        } catch {
          return ''
        }
      })(),
      snippet,
    })
  }

  return results
}

async function fetchBingPage(input: {
  query: string
  start: number
  timeoutMs: number
}): Promise<SearchPageResult> {
  try {
    const url = new URL('https://www.bing.com/search')
    url.searchParams.set('q', input.query)
    url.searchParams.set('first', String(input.start + 1))
    url.searchParams.set('setlang', 'en-US')
    url.searchParams.set('ensearch', '1')

    const response = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.8',
        'User-Agent': 'Mozilla/5.0 (compatible; SovereignEnginePublicResearch/1.0)',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(input.timeoutMs),
    })
    const html = await response.text().catch(() => '')
    if (!response.ok) {
      return { results: [], error: `bing_http_${response.status}` }
    }
    return { results: parseBingHtml(html) }
  } catch (error) {
    return { results: [], error: `bing_fetch_${error instanceof Error ? error.name : 'error'}` }
  }
}

async function fetchDuckDuckGoPage(input: {
  query: string
  start: number
  timeoutMs: number
}): Promise<SearchPageResult> {
  try {
    const url = new URL('https://html.duckduckgo.com/html/')
    url.searchParams.set('q', input.query)
    url.searchParams.set('s', String(input.start))

    const response = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.8',
        'User-Agent': 'SovereignEnginePublicResearch/1.0',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(input.timeoutMs),
    })
    const html = await response.text().catch(() => '')
    if (!response.ok) {
      return { results: [], error: `duckduckgo_http_${response.status}` }
    }
    return { results: parseDuckDuckGoHtml(html) }
  } catch (error) {
    return { results: [], error: `duckduckgo_fetch_${error instanceof Error ? error.name : 'error'}` }
  }
}

export async function searchPublicSearchLeads(input: PublicSearchLeadSearchInput): Promise<PublicSearchLeadSearchResult> {
  const apiKey = String(input.apiKey || '').trim()
  const provider: PublicSearchProvider = input.provider || (apiKey ? 'serpapi' : 'bing_html')
  if (provider === 'serpapi' && !apiKey) throw new Error('public_search_provider_key_missing')

  const industry = normalizeIndustry(input.industry)
  const persona = normalizePersona(input.persona)
  const region = normalizeRegion(input.region)
  const limit = clampInteger(input.limit, DEFAULT_LIMIT, 1, MAX_LIMIT)
  const deadlineAt = Date.now() + clampInteger(input.timeoutMs, DEFAULT_TIMEOUT_MS, 5_000, 120_000)
  const queryList = (input.queries?.length ? input.queries : defaultQueries(industry, region))
    .map((query) => query.trim())
    .filter(Boolean)
    .slice(0, 20)
  const byDomain = new Map<string, OpenLead>()
  const errors: string[] = []
  let scannedResults = 0
  let rejected = 0
  let queriesRun = 0

  for (const query of queryList) {
    if (Date.now() >= deadlineAt || byDomain.size >= limit) break
    queriesRun += 1

    for (let start = 0; start <= 90 && byDomain.size < limit; start += 10) {
      const remaining = deadlineAt - Date.now()
      if (remaining <= 0) break

      const timeoutMs = Math.min(8_000, Math.max(1_000, remaining))
      const response =
        provider === 'serpapi'
          ? await fetchSerpApiPage({
              apiKey,
              query,
              region,
              start,
              timeoutMs,
            })
          : provider === 'bing_html'
            ? await fetchBingPage({
                query,
                start,
                timeoutMs,
              })
            : await fetchDuckDuckGoPage({
                query,
                start,
                timeoutMs,
              })
      const error = response.error
      if (error) {
        errors.push(String(error).slice(0, 120))
        break
      }

      const organicResults = response.results
      if (organicResults.length === 0) break

      for (const result of organicResults) {
        scannedResults += 1
        const link = String(result.link || '').trim()
        const domain = normalizeDomainFromUrl(link)
        if (!domain || byDomain.has(domain)) {
          rejected += 1
          continue
        }
        if (isLowIntentSearchResult(result)) {
          rejected += 1
          continue
        }

        const fitScore = scoreResult(result, industry)
        if (fitScore < 58) {
          rejected += 1
          continue
        }

        byDomain.set(domain, {
          email: mailboxForPersona(domain, persona),
          company: companyFromTitle(String(result.title || ''), domain),
          companyDomain: domain,
          title: `${persona} team`,
          source: 'public_search',
          fitScore,
          reason: `Public search result matched ${industry} target profile: ${String(result.snippet || result.title || link).slice(0, 180)}`,
          confidence: fitScore >= 85 ? 'high' : fitScore >= 70 ? 'medium' : 'low',
          emailEvidence: 'synthetic_role_pattern',
          publicEvidenceUrl: link,
          autoApprovalEligible: false,
        })
      }

      if (organicResults.length < 10) break
    }
  }

  return {
    provider,
    industry,
    persona,
    region,
    leads: Array.from(byDomain.values()).slice(0, limit),
    scannedResults,
    rejected,
    queriesRun,
    errors,
    guardrails: [
      'Public search discovers company domains only',
      'No personal email guessing',
      'Only safe company role inboxes are inferred',
      'MX, provider validation, scoring, and approval gates still run before queueing',
      'Suppression, bounce, unsubscribe, and sender capacity gates remain enforced',
    ],
  }
}

export function publicSearchLeadsToContacts(leads: OpenLead[]): ContactInput[] {
  return leads.map((lead) => ({
    email: lead.email,
    name: '',
    company: lead.company,
    title: lead.title,
    source: 'public_search',
    companyDomain: lead.companyDomain,
    customFields: {
      auto_approval_eligible: Boolean(lead.autoApprovalEligible),
      data_source: 'public_search',
      email_evidence: lead.emailEvidence ?? 'synthetic_role_pattern',
      lead_scout: true,
      public_search: true,
      fit_score: lead.fitScore,
      confidence: lead.confidence,
      reason_to_contact: lead.reason,
      public_evidence_url: lead.publicEvidenceUrl ?? null,
      lead_quality_warning: lead.autoApprovalEligible
        ? 'Public evidence found; still monitor bounces and complaints.'
        : 'Role inbox inferred from public search result; requires business-safe validation and scoring before queueing.',
      approval_required: true,
      send_status: 'not_approved',
    },
  }))
}
 
