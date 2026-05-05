import { promises as dns } from 'node:dns'
import type Redis from 'ioredis'
import { cacheKeys } from './cache'

export type DomainAuthInfo = {
  domain: string
  spf: { present: boolean }
  dmarc: { present: boolean; policy?: 'none' | 'quarantine' | 'reject' }
  dkim: { present: 'unknown' } // selectors are required; left unknown here
  checkedAt: string
}

async function hasSpf(domain: string): Promise<boolean> {
  try {
    const txt = await dns.resolveTxt(domain)
    return txt.some((chunks) => chunks.join('').toLowerCase().startsWith('v=spf1'))
  } catch {
    return false
  }
}

async function dmarcPolicy(domain: string): Promise<{ present: boolean; policy?: 'none' | 'quarantine' | 'reject' }> {
  try {
    const txt = await dns.resolveTxt(`_dmarc.${domain}`)
    const record = txt.map((c) => c.join('')).find((r) => r.toLowerCase().includes('v=dmarc1'))
    if (!record) return { present: false }
    const lower = record.toLowerCase()
    const m = /(?:^|;)\s*p=([a-z]+)/.exec(lower)
    const p = (m?.[1] ?? 'none') as any
    if (p === 'reject' || p === 'quarantine' || p === 'none') return { present: true, policy: p }
    return { present: true, policy: 'none' }
  } catch {
    return { present: false }
  }
}

export async function getCachedDomainAuth(redis: Redis, domain: string): Promise<DomainAuthInfo | null> {
  const raw = await redis.get(cacheKeys.dmarc(domain))
  return raw ? (JSON.parse(raw) as DomainAuthInfo) : null
}

export async function runDomainAuthCheck(redis: Redis, domain: string): Promise<DomainAuthInfo> {
  const [spfPresent, dmarc] = await Promise.all([hasSpf(domain), dmarcPolicy(domain)])
  const info: DomainAuthInfo = {
    domain,
    spf: { present: spfPresent },
    dmarc,
    dkim: { present: 'unknown' },
    checkedAt: new Date().toISOString(),
  }
  await redis.set(cacheKeys.dmarc(domain), JSON.stringify(info), 'EX', 24 * 60 * 60)
  return info
}

