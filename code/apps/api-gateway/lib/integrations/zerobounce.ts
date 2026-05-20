import { appEnv } from '@/lib/env'
import { VerificationStatus } from '@/lib/db/types'
import { verifyEmailWithHunter } from '@/lib/integrations/hunter'

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

export async function verifyEmailAddress(email: string): Promise<VerificationResult> {
  const apiKey = appEnv.zeroBounceApiKey()
  if (!apiKey) {
    const hunterApiKey = appEnv.hunterApiKey()
    if (hunterApiKey) {
      const result = await verifyEmailWithHunter(email, { apiKey: hunterApiKey })
      const status: VerificationStatus =
        result.verdict === 'valid'
          ? 'valid'
          : result.verdict === 'invalid'
            ? 'invalid'
            : 'unknown'

      return {
        status,
        subStatus: result.error ?? (result.catchAll ? 'catch_all' : null),
        provider: 'hunter',
        score: result.score,
        error: result.error,
        raw: result.raw
          ? { provider: result.provider, ...result.raw }
          : { provider: result.provider, error: result.error ?? null },
      }
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
      return {
        status: 'unknown',
        subStatus: `zerobounce_http_${response.status}`,
        provider: 'zerobounce',
        score: 0.5,
        error: `zerobounce_http_${response.status}`,
        raw: { provider: 'zerobounce', status: response.status },
      }
    }

    const payload = (await response.json()) as {
      status?: string
      sub_status?: string
      [key: string]: unknown
    }
    const status = mapZeroBounceStatus(String(payload.status ?? 'pending'))
    const subStatus = payload.sub_status ? String(payload.sub_status) : null

    return {
      status,
      subStatus,
      provider: 'zerobounce',
      score: scoreZeroBounceResult(status, subStatus),
      raw: { provider: 'zerobounce', ...payload },
    }
  } catch (error) {
    const code = error instanceof Error && error.name === 'AbortError'
      ? 'zerobounce_timeout'
      : 'zerobounce_request_failed'

    return {
      status: 'unknown',
      subStatus: code,
      provider: 'zerobounce',
      score: 0.5,
      error: code,
      raw: { provider: 'zerobounce', error: code },
    }
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
