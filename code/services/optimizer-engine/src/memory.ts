import type { Redis } from 'ioredis'

export interface DomainMemory {
  last10BounceRates: number[]
  last10ReplyRates: number[]
  lastAction?: string
  lastActionAt?: number
  lastDailyLimit?: number
}

function clampHistory(values: number[], next: number): number[] {
  const out = [...values, next]
  while (out.length > 10) out.shift()
  return out
}

export class OptimizerMemory {
  constructor(private readonly redis: Redis) {}

  private key(domainId: number) {
    return `xv:optimizer:domain:${domainId}`
  }

  async getDomain(domainId: number): Promise<DomainMemory> {
    const raw = await this.redis.get(this.key(domainId))
    if (!raw) return { last10BounceRates: [], last10ReplyRates: [] }
    try {
      return JSON.parse(raw) as DomainMemory
    } catch {
      return { last10BounceRates: [], last10ReplyRates: [] }
    }
  }

  async updateDomain(domainId: number, patch: Partial<DomainMemory> & { bounceRate?: number; replyRate?: number }): Promise<DomainMemory> {
    const current = await this.getDomain(domainId)
    const next: DomainMemory = {
      ...current,
      ...patch,
      last10BounceRates:
        typeof patch.bounceRate === 'number' ? clampHistory(current.last10BounceRates, patch.bounceRate) : current.last10BounceRates,
      last10ReplyRates:
        typeof patch.replyRate === 'number' ? clampHistory(current.last10ReplyRates, patch.replyRate) : current.last10ReplyRates,
    }
    await this.redis.set(this.key(domainId), JSON.stringify(next), 'EX', 7 * 24 * 60 * 60)
    return next
  }
}

