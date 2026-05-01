import type { Lane } from '@sovereign/types'

export type Provider = 'gmail' | 'outlook' | 'yahoo' | 'other'

export interface ProviderPolicy {
  provider: Provider
  maxDomainConcurrency: number
  laneBias: Lane | null
  retryStrategy: 'aggressive' | 'standard' | 'conservative'
}

export function detectProvider(email: string): Provider {
  const domain = String(email || '').toLowerCase().split('@')[1] ?? ''
  if (!domain) return 'other'
  if (domain === 'gmail.com' || domain === 'googlemail.com') return 'gmail'
  if (
    domain === 'outlook.com' ||
    domain === 'hotmail.com' ||
    domain === 'live.com' ||
    domain === 'msn.com'
  )
    return 'outlook'
  if (domain === 'yahoo.com' || domain.endsWith('.yahoo.com')) return 'yahoo'
  return 'other'
}

export function getProviderPolicy(provider: Provider): ProviderPolicy {
  // Conservative by default; can be tuned via intelligence-engine later.
  if (provider === 'gmail') {
    return { provider, maxDomainConcurrency: 2, laneBias: 'slow', retryStrategy: 'conservative' }
  }
  if (provider === 'outlook') {
    return { provider, maxDomainConcurrency: 3, laneBias: 'low_risk', retryStrategy: 'standard' }
  }
  if (provider === 'yahoo') {
    return { provider, maxDomainConcurrency: 2, laneBias: 'slow', retryStrategy: 'conservative' }
  }
  return { provider, maxDomainConcurrency: 3, laneBias: null, retryStrategy: 'standard' }
}

