import type { Redis } from 'ioredis'

export interface MemoryDeps {
  redis: Redis
  namespace: string
}

export interface CampaignMemory {
  campaignId: number
  lastReplyRates: number[]
  lastBounceRates: number[]
  lastUpdatedAt: number
}

function clampHistory(values: number[], next: number, max = 20): number[] {
  const out = [...values, next]
  while (out.length > max) out.shift()
  return out
}

export async function getCampaignMemory(deps: MemoryDeps, campaignId: number): Promise<CampaignMemory | null> {
  const raw = await deps.redis.get(`${deps.namespace}:campaign:${campaignId}`)
  if (!raw) return null
  try {
    return JSON.parse(raw) as CampaignMemory
  } catch {
    return null
  }
}

export async function updateCampaignMemory(
  deps: MemoryDeps,
  campaignId: number,
  patch: { replyRate?: number; bounceRate?: number }
): Promise<CampaignMemory> {
  const current =
    (await getCampaignMemory(deps, campaignId)) ??
    ({ campaignId, lastReplyRates: [], lastBounceRates: [], lastUpdatedAt: Date.now() } satisfies CampaignMemory)

  const next: CampaignMemory = {
    ...current,
    lastReplyRates: typeof patch.replyRate === 'number' ? clampHistory(current.lastReplyRates, patch.replyRate) : current.lastReplyRates,
    lastBounceRates: typeof patch.bounceRate === 'number' ? clampHistory(current.lastBounceRates, patch.bounceRate) : current.lastBounceRates,
    lastUpdatedAt: Date.now(),
  }

  await deps.redis.set(`${deps.namespace}:campaign:${campaignId}`, JSON.stringify(next), 'EX', 30 * 24 * 60 * 60)
  return next
}

