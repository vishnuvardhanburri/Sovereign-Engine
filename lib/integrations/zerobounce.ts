import { appEnv } from '@/lib/env'
import { VerificationStatus } from '@/lib/db/types'

export interface VerificationResult {
  status: VerificationStatus
  subStatus: string | null
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
    return {
      status: 'pending',
      subStatus: null,
      raw: null,
    }
  }

  const url = new URL('https://api.zerobounce.net/v2/validate')
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('email', email)

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`ZeroBounce verification failed: ${body}`)
  }

  const payload = (await response.json()) as {
    status?: string
    sub_status?: string
    [key: string]: unknown
  }

  return {
    status: mapZeroBounceStatus(String(payload.status ?? 'pending')),
    subStatus: payload.sub_status ? String(payload.sub_status) : null,
    raw: payload,
  }
}
