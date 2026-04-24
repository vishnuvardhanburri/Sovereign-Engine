import type Redis from 'ioredis'
import { cacheKeys } from './cache'
import { validatorEnv } from './config'

export async function withDomainSmtpSlot<T>(redis: Redis, domain: string, fn: () => Promise<T>): Promise<T> {
  const key = cacheKeys.domainSmtpSlots(domain)
  const limit = validatorEnv.perDomainConcurrency()

  // Simple Redis semaphore: INCR + guard + DECR in finally.
  const current = await redis.incr(key)
  if (current === 1) {
    await redis.expire(key, 30) // safety TTL in case of crash
  }

  if (current > limit) {
    await redis.decr(key)
    const err: any = new Error('domain_smtp_concurrency_exceeded')
    err.code = 'DOMAIN_BUSY'
    throw err
  }

  try {
    return await fn()
  } finally {
    await redis.decr(key)
  }
}

