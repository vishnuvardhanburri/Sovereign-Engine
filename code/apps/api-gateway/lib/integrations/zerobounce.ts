import { appEnv } from '@/lib/env'
import { VerificationStatus } from '@/lib/db/types'
import { resolveMx } from 'node:dns/promises'
import {
  HunterVerificationResult,
  verifyEmailWithHunter,
} from '@/lib/integrations/hunter'

export interface VerificationResult {
  status: VerificationStatus
  subStatus: string | null
  provider: 'zerobounce' | 'hunter' | 'owned' | 'none'
  score: number
  error?: string
  raw: Record<string, unknown> | null
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function envFlag(name: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env[name] ?? '').trim().toLowerCase())
}

export function isHunterFallbackEnabled(): boolean {
  return envFlag('HUNTER_FALLBACK_ENABLED') || envFlag('EMAIL_VALIDATION_HUNTER_FALLBACK')
}

function scoreOwnedResult(status: VerificationStatus): number {
  if (status === 'invalid' || status === 'do_not_mail') return 0.05
  if (status === 'unknown') return 0.55
  return 0
}

async function withTimeout<T>(promise: Promise<T>, ms: number, code: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined
  const timer = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(code)), ms)
  })

  try {
    return await Promise.race([promise, timer])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export async function verifyEmailWithOwnedSignals(email: string): Promise<VerificationResult> {
  const normalized = email.trim().toLowerCase()
  if (!EMAIL_PATTERN.test(normalized)) {
    return {
      status: 'invalid',
      subStatus: 'invalid_syntax',
      provider: 'owned',
      score: scoreOwnedResult('invalid'),
      error: 'invalid_syntax',
      raw: { provider: 'owned', checks: ['syntax'], syntax: false },
    }
  }

  const domain = normalized.split('@')[1]
  if (!domain) {
    return {
      status: 'invalid',
      subStatus: 'missing_domain',
      provider: 'owned',
      score: scoreOwnedResult('invalid'),
      error: 'missing_domain',
      raw: { provider: 'owned', checks: ['syntax'], syntax: false },
    }
  }

  try {
    const records = await withTimeout(resolveMx(domain), 3_000, 'mx_lookup_timeout')
    const liveMxRecords = records.filter((record) => !['', '.'].includes(record.exchange.trim()))
    if (!liveMxRecords.length) {
      return {
        status: 'invalid',
        subStatus: 'mx_not_found',
        provider: 'owned',
        score: scoreOwnedResult('invalid'),
        error: 'mx_not_found',
        raw: { provider: 'owned', checks: ['syntax', 'mx'], syntax: true, mx: false, domain },
      }
    }

    return {
      status: 'unknown',
      subStatus: 'mx_present_unverified',
      provider: 'owned',
      score: scoreOwnedResult('unknown'),
      raw: {
        provider: 'owned',
        checks: ['syntax', 'mx'],
        syntax: true,
        mx: true,
        domain,
        mx_hosts: liveMxRecords
          .sort((a, b) => a.priority - b.priority)
          .slice(0, 3)
          .map((record) => record.exchange),
      },
    }
  } catch (error) {
    const code = error instanceof Error && error.message === 'mx_lookup_timeout'
      ? 'mx_lookup_timeout'
      : 'mx_lookup_failed'

    return {
      status: 'unknown',
      subStatus: code,
      provider: 'owned',
      score: 0.35,
      error: code,
      raw: { provider: 'owned', checks: ['syntax', 'mx'], syntax: true, mx: null, domain, error: code },
    }
  }
}

function mapZeroBounceStatus(status: string): VerificationStatus {
  switch (status) {
    case 'valid':
      return 'valid'
    case 'invalid':
      return 'invalid'
    case 'catch-all':
      return 'catch_all'
    case 'spamtrap':
    case 'abuse':
    case 'do_not_mail':
      return 'do_not_mail'
    case 'unknown':
      return 'unknown'
    default:
      return 'pending'
  }
}

function mapHunterStatus(result: HunterVerificationResult): VerificationStatus {
  if (result.verdict === 'valid') return 'valid'
  if (result.verdict === 'invalid') return 'invalid'
  if (result.verdict === 'risky' && result.catchAll) return 'catch_all'
  return 'unknown'
}

function mapHunterResult(
  result: HunterVerificationResult,
  fallback?: {
    reason: string
    zeroBounceRaw: Record<string, unknown> | null
  }
): VerificationResult {
  const status = mapHunterStatus(result)
  const raw: Record<string, unknown> = {
    provider: result.provider,
    ...(result.raw ?? {}),
  }

  if (fallback) {
    raw.fallback_from = 'zerobounce'
    raw.fallback_reason = fallback.reason
    raw.zerobounce = fallback.zeroBounceRaw
  }

  if (!result.raw && result.error) {
    raw.error = result.error
  }

  return {
    status,
    subStatus: result.error ?? (result.catchAll ? 'catch_all' : null),
    provider: 'hunter',
    score: result.score,
    error: result.error,
    raw,
  }
}

async function verifyWithHunterFallback(
  email: string,
  fallback?: {
    reason: string
    zeroBounceRaw: Record<string, unknown> | null
  }
): Promise<VerificationResult | null> {
  if (!isHunterFallbackEnabled()) return null

  const hunterApiKey = appEnv.hunterApiKey()
  if (!hunterApiKey) return null

  const result = await verifyEmailWithHunter(email, { apiKey: hunterApiKey })
  return mapHunterResult(result, fallback)
}

function shouldUseHunterFallback(status: VerificationStatus): boolean {
  return status === 'unknown' || status === 'pending'
}

function mergeHunterFallback(
  original: VerificationResult,
  fallback: VerificationResult | null
): VerificationResult {
  if (!fallback) return original
  if (!shouldUseHunterFallback(fallback.status)) return fallback

  return {
    ...original,
    subStatus: original.subStatus ?? fallback.subStatus,
    error: original.error ?? fallback.error,
    raw: {
      ...(original.raw ?? {}),
      hunter_fallback: fallback.raw,
    },
  }
}

export async function verifyEmailAddress(email: string): Promise<VerificationResult> {
  const apiKey = appEnv.zeroBounceApiKey()
  if (!apiKey) {
    const hunterFallback = await verifyWithHunterFallback(email)
    if (hunterFallback) {
      return hunterFallback
    }

    return verifyEmailWithOwnedSignals(email)
  }

  const url = new URL('https://api.zerobounce.net/v2/validate')
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('email', email)

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8_000),
    })

    if (!response.ok) {
      const ownedFallback = await verifyEmailWithOwnedSignals(email)
      const original: VerificationResult = {
        status: 'unknown',
        subStatus: `zerobounce_http_${response.status}`,
        provider: 'zerobounce',
        score: 0.5,
        error: `zerobounce_http_${response.status}`,
        raw: { provider: 'zerobounce', status: response.status, owned_fallback: ownedFallback.raw },
      }
      const fallback = await verifyWithHunterFallback(email, {
        reason: original.error ?? 'zerobounce_http_error',
        zeroBounceRaw: original.raw,
      })
      return ownedFallback.status === 'invalid' ? ownedFallback : mergeHunterFallback(original, fallback)
    }

    const payload = (await response.json()) as {
      status?: string
      sub_status?: string
      [key: string]: unknown
    }
    const status = mapZeroBounceStatus(String(payload.status ?? 'pending'))
    const subStatus = payload.sub_status ? String(payload.sub_status) : null

    const original: VerificationResult = {
      status,
      subStatus,
      provider: 'zerobounce',
      score: scoreZeroBounceResult(status, subStatus),
      raw: { provider: 'zerobounce', ...payload },
    }

    if (shouldUseHunterFallback(status)) {
      const fallback = await verifyWithHunterFallback(email, {
        reason: `zerobounce_${status}`,
        zeroBounceRaw: original.raw,
      })
      return mergeHunterFallback(original, fallback)
    }

    return original
  } catch (error) {
    const code = error instanceof Error && error.name === 'AbortError'
      ? 'zerobounce_timeout'
      : 'zerobounce_request_failed'

    const ownedFallback = await verifyEmailWithOwnedSignals(email)
    const original: VerificationResult = {
      status: 'unknown',
      subStatus: code,
      provider: 'zerobounce',
      score: 0.5,
      error: code,
      raw: { provider: 'zerobounce', error: code, owned_fallback: ownedFallback.raw },
    }
    const fallback = await verifyWithHunterFallback(email, {
      reason: code,
      zeroBounceRaw: original.raw,
    })
    return ownedFallback.status === 'invalid' ? ownedFallback : mergeHunterFallback(original, fallback)
  }
}

function scoreZeroBounceResult(
  status: VerificationStatus,
  subStatus: string | null
): number {
  if (status === 'valid') return subStatus === 'role_based' ? 0.85 : 0.95
  if (status === 'invalid' || status === 'do_not_mail') return 0.05
  if (status === 'catch_all') return 0.65
  if (status === 'unknown') return 0.5
  return 0
}
