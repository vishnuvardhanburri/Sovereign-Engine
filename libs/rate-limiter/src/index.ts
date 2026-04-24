import type { Redis } from 'ioredis'

/**
 * Very small Redis semaphore for per-domain concurrency.
 * Adapter-mode: good enough for safety; can be replaced later.
 */
export class RedisSemaphore {
  constructor(private readonly redis: Redis) {}

  private key(name: string) {
    return `xv:sem:${name}`
  }

  async acquire(name: string, limit: number, ttlMs: number): Promise<boolean> {
    const key = this.key(name)
    const now = Date.now()
    // Use a ZSET of lease ids with expiry scores.
    const leaseId = `${now}:${Math.random().toString(16).slice(2)}`
    const multi = this.redis.multi()
    multi.zremrangebyscore(key, 0, now)
    multi.zcard(key)
    const res = await multi.exec()
    const count = Number(res?.[1]?.[1] ?? 0)
    if (count >= limit) return false
    await this.redis.zadd(key, now + ttlMs, leaseId)
    await this.redis.pexpire(key, ttlMs + 60_000)
    return true
  }
}

