import type { Redis } from 'ioredis'

export type CircuitKeyType = 'domain' | 'identity'

export interface CircuitState {
  isOpen: boolean
  failCount: number
  openedAt?: number
  nextTryAt?: number
}

/**
 * Redis-backed circuit breaker, designed for queue-driven workers.
 *
 * Rules:
 * - `recordFailure` increments per-key fail count
 * - once threshold is hit, circuit opens for `openMs`
 * - `checkCircuit` returns false while open
 */
export class CircuitBreaker {
  constructor(
    private readonly redis: Redis,
    private readonly opts: {
      threshold?: number
      openMs?: number
    } = {}
  ) {}

  private threshold(): number {
    return Math.max(1, this.opts.threshold ?? 5)
  }

  private openMs(): number {
    return Math.max(10_000, this.opts.openMs ?? 10 * 60_000)
  }

  private key(id: string, type: CircuitKeyType): string {
    return `xv:circuit:${type}:${id}`
  }

  async getState(id: string, type: CircuitKeyType): Promise<CircuitState> {
    const k = this.key(id, type)
    const raw = await this.redis.hgetall(k)
    const failCount = Number(raw.failCount ?? 0)
    const openedAt = raw.openedAt ? Number(raw.openedAt) : undefined
    const nextTryAt = raw.nextTryAt ? Number(raw.nextTryAt) : undefined
    const isOpen = Boolean(nextTryAt && nextTryAt > Date.now())
    return { isOpen, failCount, openedAt, nextTryAt }
  }

  async checkCircuit(id: string, type: CircuitKeyType): Promise<boolean> {
    const state = await this.getState(id, type)
    return !state.isOpen
  }

  async recordSuccess(id: string, type: CircuitKeyType): Promise<void> {
    const k = this.key(id, type)
    await this.redis.del(k)
  }

  async recordFailure(id: string, type: CircuitKeyType, reason?: string): Promise<CircuitState> {
    const k = this.key(id, type)
    const nextFailCount = await this.redis.hincrby(k, 'failCount', 1)

    if (reason) {
      await this.redis.hset(k, 'lastReason', String(reason).slice(0, 500))
    }

    if (nextFailCount >= this.threshold()) {
      const openedAt = Date.now()
      const nextTryAt = openedAt + this.openMs()
      await this.redis.hset(k, {
        openedAt: String(openedAt),
        nextTryAt: String(nextTryAt),
      })
      await this.redis.pexpire(k, this.openMs() + 60_000)
      return { isOpen: true, failCount: nextFailCount, openedAt, nextTryAt }
    }

    await this.redis.pexpire(k, this.openMs() + 60_000)
    return { isOpen: false, failCount: nextFailCount }
  }
}

