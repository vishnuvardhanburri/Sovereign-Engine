import crypto from 'node:crypto'
import { getRedisClient } from '@/lib/redis'

export interface DistributedLock {
  key: string
  token: string
  ttlMs: number
}

export async function acquireDistributedLock(key: string, ttlMs = 60_000): Promise<DistributedLock | null> {
  const redis = await getRedisClient()
  const token = crypto.randomUUID()
  const ok = await redis.set(`xv:lock:${key}`, token, { NX: true, PX: ttlMs })
  return ok ? { key, token, ttlMs } : null
}

export async function releaseDistributedLock(lock: DistributedLock): Promise<boolean> {
  const redis = await getRedisClient()
  const script = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    end
    return 0
  `
  const result = await redis.eval(script, {
    keys: [`xv:lock:${lock.key}`],
    arguments: [lock.token],
  })
  return Number(result) === 1
}

export async function withDistributedLock<T>(
  key: string,
  ttlMs: number,
  callback: () => Promise<T>
): Promise<T | null> {
  const lock = await acquireDistributedLock(key, ttlMs)
  if (!lock) return null
  try {
    return await callback()
  } finally {
    await releaseDistributedLock(lock).catch(() => false)
  }
}
