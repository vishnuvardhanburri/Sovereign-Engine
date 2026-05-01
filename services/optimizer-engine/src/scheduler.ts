import type { DbExecutor } from '@sovereign/types'
import type { Redis } from 'ioredis'
import { runOptimizerOnce, type OptimizerMode } from './optimizer'

export function startScheduler(opts: {
  clientId: number
  db: DbExecutor
  redis: Redis
  mode: OptimizerMode
  intervalMs?: number
}) {
  const intervalMs = Math.max(60_000, opts.intervalMs ?? 10 * 60_000)

  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await runOptimizerOnce({ db: opts.db, redis: opts.redis, mode: opts.mode }, opts.clientId)
    } catch (err) {
      console.error('[optimizer-engine] tick failed', { err: (err as any)?.message ?? String(err) })
    } finally {
      running = false
    }
  }

  // fire immediately, then interval
  void tick()
  const handle = setInterval(() => void tick(), intervalMs)
  return () => clearInterval(handle)
}

