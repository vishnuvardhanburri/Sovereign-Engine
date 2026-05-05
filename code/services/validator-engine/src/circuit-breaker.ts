import type Redis from 'ioredis'
import { cacheKeys } from './cache'
import { validatorEnv } from './config'

export async function isBreakerOpen(redis: Redis, domain: string): Promise<boolean> {
  const until = await redis.get(cacheKeys.domainBreaker(domain))
  if (!until) return false
  return Number(until) > Date.now()
}

export async function openBreaker(redis: Redis, domain: string, reason: string): Promise<void> {
  const ttl = validatorEnv.breakerTtlSeconds()
  const until = Date.now() + ttl * 1000
  await redis.set(cacheKeys.domainBreaker(domain), String(until), 'EX', ttl)
  // Lightweight metric
  await redis.hincrby(cacheKeys.metrics(), 'domain_breaker_opened', 1)
  await redis.hset(cacheKeys.metrics(), `domain_breaker_reason:${reason}`, String((Number(await redis.hget(cacheKeys.metrics(), `domain_breaker_reason:${reason}`)) || 0) + 1))
}

export async function recordDomainFailure(redis: Redis, domain: string): Promise<void> {
  const key = `${cacheKeys.domainBreaker(domain)}:fail`
  const n = await redis.incr(key)
  if (n === 1) {
    await redis.expire(key, validatorEnv.breakerTtlSeconds())
  }

  // Trip after 5 failures within breaker window.
  if (n >= 5) {
    await openBreaker(redis, domain, 'smtp_failures')
  }
}

export async function recordDomainSuccess(redis: Redis, domain: string): Promise<void> {
  const key = `${cacheKeys.domainBreaker(domain)}:fail`
  await redis.del(key)
}

