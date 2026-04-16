import { Redis } from '@upstash/redis'

// Initialize Upstash Redis client
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

export async function getRedis(): Promise<Redis> {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    throw new Error('Redis environment variables not configured')
  }
  return redis
}

// Queue operations
export async function enqueueJob(job: {
  contact_id: number
  campaign_id: number
  domain_id: number
  scheduled_at?: string
}): Promise<number> {
  const r = await getRedis()
  const jobId = Date.now()
  await r.lpush('email:queue', JSON.stringify({ ...job, id: jobId }))
  return jobId
}

export async function dequeueJob(): Promise<{
  contact_id: number
  campaign_id: number
  domain_id: number
  scheduled_at?: string
  id: number
} | null> {
  const r = await getRedis()
  const job = await r.rpop('email:queue')
  return job ? JSON.parse(job) : null
}

export async function getQueueLength(): Promise<number> {
  const r = await getRedis()
  return (await r.llen('email:queue')) || 0
}

export async function peekQueue(
  count: number = 10
): Promise<any[]> {
  const r = await getRedis()
  const jobs = await r.lrange('email:queue', 0, count - 1)
  return jobs ? jobs.map(j => JSON.parse(j)) : []
}

// Token bucket for rate limiting
export interface TokenBucket {
  tokens: number
  last_refill: number
}

export async function initializeTokenBucket(
  identity_id: number,
  initial_tokens: number = 1
): Promise<void> {
  const r = await getRedis()
  const key = `bucket:${identity_id}`
  const bucket: TokenBucket = {
    tokens: initial_tokens,
    last_refill: Date.now(),
  }
  await r.set(key, JSON.stringify(bucket), { ex: 86400 }) // 24h expiry
}

export async function getTokenBucket(
  identity_id: number
): Promise<TokenBucket | null> {
  const r = await getRedis()
  const key = `bucket:${identity_id}`
  const data = await r.get(key)
  return data ? JSON.parse(data) : null
}

export async function consumeToken(
  identity_id: number,
  refillInterval: number = 90 // 60-120s average
): Promise<{ available: boolean; wait_seconds: number }> {
  const r = await getRedis()
  const key = `bucket:${identity_id}`

  // Initialize if doesn't exist
  let bucket = await getTokenBucket(identity_id)
  if (!bucket) {
    await initializeTokenBucket(identity_id, 1)
    bucket = await getTokenBucket(identity_id)!
  }

  const now = Date.now()
  const secondsElapsed = (now - bucket!.last_refill) / 1000

  // Refill tokens based on time elapsed
  // For 90s interval, generate 1 token every 90s
  const tokensGenerated = Math.floor(secondsElapsed / refillInterval)
  const newTokens = Math.min(bucket!.tokens + tokensGenerated, 1) // Max 1 token

  if (newTokens >= 1) {
    // Consume token
    const updated: TokenBucket = {
      tokens: newTokens - 1,
      last_refill: now,
    }
    await r.set(key, JSON.stringify(updated), { ex: 86400 })
    return { available: true, wait_seconds: 0 }
  } else {
    // Token not available, calculate wait time
    const waitSeconds = Math.ceil(
      refillInterval - secondsElapsed
    )
    return { available: false, wait_seconds: waitSeconds }
  }
}

// Domain quota tracking
export async function incrementSentCount(
  identity_id: number,
  domain_id: number
): Promise<void> {
  const r = await getRedis()
  const identityKey = `sent:${identity_id}`
  const domainKey = `sent:domain:${domain_id}`

  await Promise.all([
    r.incr(identityKey),
    r.incr(domainKey),
    r.expire(identityKey, 86400), // Reset daily
    r.expire(domainKey, 86400),
  ])
}

export async function getSentCount(identity_id: number): Promise<number> {
  const r = await getRedis()
  const count = await r.get(`sent:${identity_id}`)
  return count ? parseInt(count) : 0
}

export async function getDomainSentCount(domain_id: number): Promise<number> {
  const r = await getRedis()
  const count = await r.get(`sent:domain:${domain_id}`)
  return count ? parseInt(count) : 0
}

export async function resetDailyCounts(domain_id: number): Promise<void> {
  const r = await getRedis()
  const key = `sent:domain:${domain_id}`
  await r.del(key)
}

// Generic key-value operations
export async function setValue(key: string, value: any, ttl?: number): Promise<void> {
  const r = await getRedis()
  await r.set(key, JSON.stringify(value), { ex: ttl })
}

export async function getValue(key: string): Promise<any | null> {
  const r = await getRedis()
  const data = await r.get(key)
  return data ? JSON.parse(data) : null
}

export async function deleteKey(key: string): Promise<void> {
  const r = await getRedis()
  await r.del(key)
}
