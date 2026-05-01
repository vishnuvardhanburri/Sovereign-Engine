import crypto from 'crypto'
import net from 'net'
import { resolve4, resolveMx, resolveTxt } from 'dns/promises'
import { query, queryOne } from '@/lib/db'
import { getRedisClient } from '@/lib/redis'

type Provider = 'gmail' | 'outlook' | 'yahoo'
type ProviderState = 'HEALTHY' | 'THROTTLED' | 'PAUSED' | 'UNKNOWN'
type RiskLevel = 'low' | 'medium' | 'high' | 'critical' | 'unknown'
type Tier = 'free' | 'pro' | 'enterprise'

const PROVIDERS: Provider[] = ['gmail', 'outlook', 'yahoo']
const REGION = process.env.XV_REGION ?? 'prod'

type PublicApiKeyRow = {
  id: string
  client_id: string | number | null
  name: string
  key_prefix: string
  tier: Tier
  daily_limit: string | number | null
}

type DomainRow = {
  id: string | number
  client_id: string | number
  domain: string
  status: string
  health_score: string | number | null
  bounce_rate: string | number | null
  spam_rate: string | number | null
  sent_today: string | number | null
  daily_limit: string | number | null
}

type LaneRow = {
  provider: Provider
  state: string
  max_per_hour: string | number | null
  max_per_minute: string | number | null
  max_concurrency: string | number | null
  reasons: unknown
  metrics_snapshot: any
  updated_at: string | null
}

type CachedLaneSignal = {
  provider: Provider
  state?: string
  action?: string
  maxPerHour?: number
  maxPerMinute?: number
  maxConcurrency?: number
  reasons?: string[]
  metrics?: Record<string, unknown>
  cooldownUntil?: string | null
}

export type PublicReputationInput = {
  domain?: string
  ip?: string
}

export type AuthenticatedPublicApiKey = {
  id: number | null
  clientId: number | null
  keyPrefix: string
  tier: Tier
  dailyLimit: number
  source: 'database' | 'env'
}

export type RateLimitResult = {
  allowed: boolean
  used: number
  limit: number
  resetAt: string
}

function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function toNumber(value: unknown, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function normalizeDomain(raw?: string) {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return ''
  const withoutProtocol = value.replace(/^https?:\/\//, '')
  return withoutProtocol.split('/')[0]!.replace(/^www\./, '').replace(/\.$/, '')
}

function normalizeIp(raw?: string) {
  const value = String(raw ?? '').trim()
  return net.isIP(value) ? value : ''
}

function tierLimit(tier: Tier) {
  if (tier === 'enterprise') return Number(process.env.PUBLIC_REPUTATION_ENTERPRISE_DAILY_LIMIT ?? 100_000)
  if (tier === 'pro') return Number(process.env.PUBLIC_REPUTATION_PRO_DAILY_LIMIT ?? 1_000)
  return Number(process.env.PUBLIC_REPUTATION_FREE_DAILY_LIMIT ?? 10)
}

function extractPresentedKey(request: Request) {
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  return (request.headers.get('x-api-key') || bearer || '').trim()
}

function safeJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  }
  return []
}

function safeJsonObject(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }
  return {}
}

function ymd(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

function nextUtcMidnight() {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function getCachedJson<T>(key: string): Promise<T | null> {
  try {
    const redis = await getRedisClient()
    const raw = await redis.get(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

async function setCachedJson(key: string, value: unknown, ttlSec: number) {
  try {
    const redis = await getRedisClient()
    await redis.set(key, JSON.stringify(value), { EX: ttlSec })
  } catch {
    // Cache is an accelerator only; never fail the certificate because Redis cache write failed.
  }
}

export async function authenticatePublicApiKey(request: Request): Promise<AuthenticatedPublicApiKey | null> {
  const presented = extractPresentedKey(request)
  if (!presented) return null

  const keyHash = sha256(presented)
  const row = await queryOne<PublicApiKeyRow>(
    `SELECT id, client_id, name, key_prefix, tier, daily_limit
     FROM public_api_keys
     WHERE key_hash = $1
       AND status = 'active'
       AND (expires_at IS NULL OR expires_at > now())
     LIMIT 1`,
    [keyHash]
  ).catch(() => null)

  if (row) {
    const tier = row.tier
    return {
      id: Number(row.id),
      clientId: row.client_id == null ? null : Number(row.client_id),
      keyPrefix: row.key_prefix,
      tier,
      dailyLimit: toNumber(row.daily_limit, tierLimit(tier)),
      source: 'database',
    }
  }

  const legacyKey = process.env.REPUTATION_PUBLIC_API_KEY
  if (legacyKey && presented === legacyKey) {
    const tier = (process.env.REPUTATION_PUBLIC_API_TIER as Tier | undefined) ?? 'pro'
    return {
      id: null,
      clientId: null,
      keyPrefix: `env_${keyHash.slice(0, 8)}`,
      tier,
      dailyLimit: tierLimit(tier),
      source: 'env',
    }
  }

  return null
}

export async function enforcePublicRateLimit(apiKey: AuthenticatedPublicApiKey): Promise<RateLimitResult> {
  const redis = await getRedisClient()
  const resetAt = nextUtcMidnight()
  const principal = apiKey.id ? `db:${apiKey.id}` : `env:${apiKey.keyPrefix}`
  const key = `xv:${REGION}:raas:rate:${principal}:${ymd()}`
  const used = await redis.incr(key)
  if (used === 1) {
    await redis.expire(key, Math.max(60, Math.ceil((resetAt.getTime() - Date.now()) / 1000) + 60))
  }
  return {
    allowed: used <= apiKey.dailyLimit,
    used,
    limit: apiKey.dailyLimit,
    resetAt: resetAt.toISOString(),
  }
}

async function resolveTxtFlat(name: string) {
  try {
    const records = await withTimeout(resolveTxt(name), 1_500, [] as string[][])
    return records.map((parts) => parts.join(''))
  } catch {
    return []
  }
}

async function lightDnsScan(domain: string) {
  const [mxRecords, txtRecords, dmarcRecords, aRecords] = await Promise.all([
    withTimeout(resolveMx(domain), 1_500, []),
    resolveTxtFlat(domain),
    resolveTxtFlat(`_dmarc.${domain}`),
    withTimeout(resolve4(domain), 1_500, []),
  ])

  const spf = txtRecords.find((record) => /^v=spf1\s/i.test(record)) || ''
  const dmarc = dmarcRecords.find((record) => /^v=DMARC1\s*;/i.test(record)) || ''
  const dmarcPolicy = dmarc.match(/(?:^|;)\s*p=([^;\s]+)/i)?.[1]?.toLowerCase() ?? ''

  return {
    checked_at: new Date().toISOString(),
    mx: {
      present: mxRecords.length > 0,
      count: mxRecords.length,
      hosts: mxRecords.slice(0, 5).map((record) => record.exchange),
    },
    a: {
      present: aRecords.length > 0,
      count: aRecords.length,
    },
    spf: {
      present: Boolean(spf),
      strict: Boolean(spf) && !/\+all\b/i.test(spf),
      record: spf || null,
    },
    dmarc: {
      present: Boolean(dmarc),
      policy: dmarcPolicy || null,
      strong: dmarcPolicy === 'quarantine' || dmarcPolicy === 'reject',
      record: dmarc || null,
    },
  }
}

function reverseIpv4(ip: string) {
  return ip.split('.').reverse().join('.')
}

async function dnsblCheck(name: string) {
  try {
    const addresses = await withTimeout(resolve4(name), 1_500, [] as string[])
    return addresses.length
      ? { listed: true, status: 'listed', response: addresses }
      : { listed: false, status: 'clear', response: [] }
  } catch (error) {
    const code = (error as any)?.code
    if (code === 'ENOTFOUND' || code === 'ENODATA') return { listed: false, status: 'clear', response: [] }
    return { listed: false, status: 'unknown', response: [] }
  }
}

async function blacklistScan(domain: string, ip: string) {
  const cacheKey = `xv:${REGION}:raas:blacklist:${domain || '-'}:${ip || '-'}`
  const cached = await getCachedJson<any>(cacheKey)
  if (cached) return { ...cached, cache_hit: true }

  const checks: Record<string, any> = {}
  if (domain) {
    const [spamhausDbl, uribl] = await Promise.all([
      dnsblCheck(`${domain}.dbl.spamhaus.org`),
      dnsblCheck(`${domain}.multi.uribl.com`),
    ])
    checks.domain = {
      spamhaus_dbl: spamhausDbl,
      uribl,
    }
  }

  if (net.isIPv4(ip)) {
    checks.ip = {
      spamhaus_zen: await dnsblCheck(`${reverseIpv4(ip)}.zen.spamhaus.org`),
    }
  } else if (ip) {
    checks.ip = {
      spamhaus_zen: { listed: false, status: 'unsupported_ipv6', response: [] },
    }
  }

  const listed = Object.values(checks)
    .flatMap((group: any) => Object.values(group))
    .some((result: any) => result?.listed)

  const result = {
    checked_at: new Date().toISOString(),
    cache_hit: false,
    listed,
    checks,
  }
  await setCachedJson(cacheKey, result, Number(process.env.PUBLIC_REPUTATION_BLACKLIST_CACHE_SEC ?? 6 * 60 * 60))
  return result
}

function laneStatus(state: string, maxPerHour: number): ProviderState {
  if (state === 'paused' || maxPerHour <= 0) return 'PAUSED'
  if (state === 'warmup' || state === 'degraded' || state === 'cooldown') return 'THROTTLED'
  if (state === 'normal') return 'HEALTHY'
  return 'UNKNOWN'
}

function riskFromScore(score: number, status: ProviderState): RiskLevel {
  if (status === 'PAUSED') return 'critical'
  if (score < 50) return 'critical'
  if (score < 70) return 'high'
  if (score < 85) return 'medium'
  return 'low'
}

function scoreProvider(status: ProviderState, metrics: Record<string, unknown>) {
  const deferral = clamp(toNumber(metrics.deferralRate1h), 0, 1)
  const block = clamp(toNumber(metrics.blockRate1h), 0, 1)
  const seed = clamp(toNumber(metrics.seedPlacementInboxRate, 1), 0, 1)
  const statePenalty = status === 'PAUSED' ? 45 : status === 'THROTTLED' ? 18 : status === 'UNKNOWN' ? 10 : 0
  return clamp(Math.round(100 - statePenalty - deferral * 260 - block * 500 - (1 - seed) * 40), 0, 100)
}

async function readCachedLane(clientId: number, domainId: number, provider: Provider): Promise<CachedLaneSignal | null> {
  return getCachedJson<CachedLaneSignal>(`xv:${REGION}:adaptive:lane:${clientId}:${domainId}:${provider}`)
}

function providerStatusFrom(input: { provider: Provider; row?: LaneRow; cached?: CachedLaneSignal | null }) {
  const cached = input.cached
  const row = input.row
  const state = cached?.state ?? row?.state ?? 'unknown'
  const maxPerHour = toNumber(cached?.maxPerHour ?? row?.max_per_hour)
  const maxPerMinute = toNumber(cached?.maxPerMinute ?? row?.max_per_minute)
  const maxConcurrency = toNumber(cached?.maxConcurrency ?? row?.max_concurrency)
  const metrics = cached?.metrics ?? safeJsonObject(row?.metrics_snapshot).metrics ?? safeJsonObject(row?.metrics_snapshot)
  const status = laneStatus(state, maxPerHour)
  const score = scoreProvider(status, metrics)

  return {
    status,
    risk_level: riskFromScore(score, status),
    score,
    max_per_hour: maxPerHour,
    max_per_minute: maxPerMinute,
    max_concurrency: maxConcurrency,
    source: cached ? 'reputation_worker_cache' : row ? 'postgres' : 'not_observed',
    reasons: cached?.reasons ?? safeJsonArray(row?.reasons),
    signals: {
      deferral_rate_1h: toNumber(metrics.deferralRate1h),
      block_rate_1h: toNumber(metrics.blockRate1h),
      send_success_rate_1h: toNumber(metrics.sendSuccessRate1h, 1),
      seed_placement_inbox_rate: toNumber(metrics.seedPlacementInboxRate, 1),
      provider_risk: toNumber(metrics.providerRisk),
    },
    cooldown_until: cached?.cooldownUntil ?? null,
    updated_at: row?.updated_at ?? null,
  }
}

function recommendation(input: { observed: boolean; score: number; blacklistListed: boolean; providerStatuses: Record<Provider, any>; dnsStatus: any }) {
  if (input.blacklistListed) return 'Immediate Cooldown required: blacklist listing detected.'
  if (Object.values(input.providerStatuses).some((lane: any) => lane.status === 'PAUSED')) return 'Immediate Cooldown required: one or more provider lanes are paused.'
  if (input.score >= 85 && input.dnsStatus?.spf?.strict && input.dnsStatus?.dmarc?.present) return 'Safe to scale gradually under the adaptive ramp.'
  if (!input.observed) return 'Light scan only: verify DNS, run seed placement, and start at slow warmup volume.'
  if (input.score >= 70) return 'Proceed cautiously: keep current ramp and monitor deferrals.'
  return 'Reduce throughput and investigate provider-specific risk before scaling.'
}

function scoreShadowScan(dnsStatus: any, blacklistStatus: any) {
  let score = 45
  if (!dnsStatus) {
    return clamp(score + (blacklistStatus.listed ? -45 : 10), 0, 100)
  }
  if (dnsStatus.mx.present) score += 12
  if (dnsStatus.spf.present) score += dnsStatus.spf.strict ? 14 : 6
  if (dnsStatus.dmarc.present) score += dnsStatus.dmarc.strong ? 16 : 10
  if (!blacklistStatus.listed) score += 13
  if (blacklistStatus.listed) score -= 45
  return clamp(score, 0, 100)
}

export async function buildHealthCertificate(input: PublicReputationInput) {
  const domain = normalizeDomain(input.domain)
  const ip = normalizeIp(input.ip)
  if (!domain && !ip) throw new Error('domain_or_ip_required')
  if (input.domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) throw new Error('invalid_domain')
  if (input.ip && !ip) throw new Error('invalid_ip')

  const [domainResult, dnsStatus, blacklistStatus] = await Promise.all([
    domain
      ? query<DomainRow>(
          `SELECT id, client_id, domain, status, health_score, bounce_rate, spam_rate, sent_today, daily_limit
           FROM domains
           WHERE lower(domain) = $1
           ORDER BY updated_at DESC
           LIMIT 1`,
          [domain]
        )
      : Promise.resolve({ rows: [], rowCount: 0 }),
    domain ? lightDnsScan(domain) : Promise.resolve(null),
    blacklistScan(domain, ip),
  ])

  const domainRow = domainResult.rows[0] ?? null
  let providerStatuses: Record<Provider, any>
  let reputationScore: number

  if (domainRow) {
    const domainId = Number(domainRow.id)
    const clientId = Number(domainRow.client_id)
    const laneRows = await query<LaneRow>(
      `SELECT provider, state, max_per_hour, max_per_minute, max_concurrency, reasons, metrics_snapshot, updated_at
       FROM reputation_state
       WHERE client_id = $1 AND domain_id = $2 AND provider = ANY($3::text[])`,
      [clientId, domainId, PROVIDERS]
    )
    const byProvider = new Map(laneRows.rows.map((row) => [row.provider, row]))
    const cached = await Promise.all(PROVIDERS.map((provider) => readCachedLane(clientId, domainId, provider)))
    providerStatuses = Object.fromEntries(
      PROVIDERS.map((provider, idx) => [provider, providerStatusFrom({ provider, row: byProvider.get(provider), cached: cached[idx] })])
    ) as Record<Provider, any>

    const baseScore = clamp(toNumber(domainRow.health_score, 70), 0, 100)
    const providerAvg = Object.values(providerStatuses).reduce((sum, lane: any) => sum + lane.score, 0) / PROVIDERS.length
    const bouncePenalty = clamp(toNumber(domainRow.bounce_rate) * 2, 0, 25)
    const spamPenalty = clamp(toNumber(domainRow.spam_rate) * 100, 0, 25)
    const blacklistPenalty = blacklistStatus.listed ? 45 : 0
    reputationScore = clamp(Math.round(baseScore * 0.45 + providerAvg * 0.55 - bouncePenalty - spamPenalty - blacklistPenalty), 0, 100)
  } else {
    const shadowScore = scoreShadowScan(dnsStatus, blacklistStatus)
    providerStatuses = Object.fromEntries(
      PROVIDERS.map((provider) => [
        provider,
        {
          status: 'UNKNOWN',
          risk_level: shadowScore >= 70 ? 'medium' : 'high',
          score: shadowScore,
          max_per_hour: 0,
          max_per_minute: 0,
          max_concurrency: 0,
          source: 'shadow_light_scan',
          reasons: ['domain_not_observed'],
          signals: null,
          cooldown_until: null,
          updated_at: null,
        },
      ])
    ) as Record<Provider, any>
    reputationScore = shadowScore
  }

  const cert = {
    ok: true,
    product: 'sovereign-reputation-shield',
    version: 'v1',
    certificate_id: `xvra_${sha256(`${domain}:${ip}:${Date.now()}`).slice(0, 24)}`,
    issued_at: new Date().toISOString(),
    input: { domain: domain || null, ip: ip || null },
    observed: Boolean(domainRow),
    reputation_score: reputationScore,
    provider_status: providerStatuses,
    blacklist_status: blacklistStatus,
    dns_status: dnsStatus,
    recommendation: recommendation({
      observed: Boolean(domainRow),
      score: reputationScore,
      blacklistListed: blacklistStatus.listed,
      providerStatuses,
      dnsStatus,
    }),
  }

  return {
    certificate: cert,
    logMeta: {
      domain: domain || null,
      ip: ip || null,
      reputationScore,
      cacheHit: Object.values(providerStatuses).some((lane: any) => lane.source === 'reputation_worker_cache') || blacklistStatus.cache_hit,
    },
  }
}

export async function logReputationApiCall(input: {
  apiKey: AuthenticatedPublicApiKey
  payload: PublicReputationInput
  responseStatus: number
  reputationScore: number
  cacheHit: boolean
  latencyMs: number
}) {
  await Promise.allSettled([
    query(
      `INSERT INTO reputation_api_logs (
         api_key_id, client_id, domain, ip, request_payload, response_status,
         reputation_score, tier, billable_units, cache_hit, latency_ms
       )
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,1,$9,$10)`,
      [
        input.apiKey.id,
        input.apiKey.clientId,
        normalizeDomain(input.payload.domain) || null,
        normalizeIp(input.payload.ip) || null,
        JSON.stringify(input.payload),
        input.responseStatus,
        input.reputationScore,
        input.apiKey.tier,
        input.cacheHit,
        input.latencyMs,
      ]
    ),
    input.apiKey.id
      ? query(`UPDATE public_api_keys SET last_used_at = now(), updated_at = now() WHERE id = $1`, [input.apiKey.id])
      : Promise.resolve(),
  ])
}
