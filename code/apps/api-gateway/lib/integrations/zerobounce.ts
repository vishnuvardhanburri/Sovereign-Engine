import { appEnv } from '@/lib/env'
import { VerificationStatus } from '@/lib/db/types'
import {
  HunterVerificationResult,
  verifyEmailWithHunter,
} from '@/lib/integrations/hunter'

export interface VerificationResult {
  status: VerificationStatus
  subStatus: string | null
  provider: 'zerobounce' | 'hunter' | 'none'
  score: number
  error?: string
  raw: Record<string, unknown> | null
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

    return {
      status: 'pending',
      subStatus: null,
      provider: 'none',
      score: 0,
      raw: null,
    }
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
      const original: VerificationResult = {
        status: 'unknown',
        subStatus: `zerobounce_http_${response.status}`,
        provider: 'zerobounce',
        score: 0.5,
        error: `zerobounce_http_${response.status}`,
        raw: { provider: 'zerobounce', status: response.status },
      }
      const fallback = await verifyWithHunterFallback(email, {
        reason: original.error ?? 'zerobounce_http_error',
        zeroBounceRaw: original.raw,
      })
      return mergeHunterFallback(original, fallback)
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

    const original: VerificationResult = {
      status: 'unknown',
      subStatus: code,
      provider: 'zerobounce',
      score: 0.5,
      error: code,
      raw: { provider: 'zerobounce', error: code },
    }
    const fallback = await verifyWithHunterFallback(email, {
      reason: code,
      zeroBounceRaw: original.raw,
    })
    return mergeHunterFallback(original, fallback)
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
