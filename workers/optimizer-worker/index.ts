import 'dotenv/config'
import IORedis from 'ioredis'
import { Pool } from 'pg'
import { startScheduler } from '@sovereign/optimizer-engine'
import type { DbExecutor } from '@sovereign/types'

function reqEnv(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

function boolEnv(name: string, def = false) {
  const v = process.env[name]
  if (v == null) return def
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes'
}

function intEnv(name: string, def: number) {
  const v = process.env[name]
  if (!v) return def
  const n = Number(v)
  return Number.isFinite(n) ? n : def
}

async function main() {
  const enabled = boolEnv('OPTIMIZER_ENABLED', false)
  if (!enabled) {
    console.log('[optimizer-worker] OPTIMIZER_ENABLED not set; exiting (no-op)')
    return
  }

  const clientId = intEnv('OPTIMIZER_CLIENT_ID', 1)
  const intervalMs = intEnv('OPTIMIZER_INTERVAL_MS', 10 * 60_000)
  const mode = (process.env.OPTIMIZER_MODE ?? 'observe') as 'observe' | 'apply'

  const pool = new Pool({ connectionString: reqEnv('DATABASE_URL') })
  const redis = new IORedis(reqEnv('REDIS_URL'))

  const db: DbExecutor = async (sql, params = []) => {
    const res = await pool.query(sql, params as any[])
    return { rows: res.rows as any[], rowCount: res.rowCount ?? 0 }
  }

  console.log('[optimizer-worker] starting scheduler', { clientId, intervalMs, mode })
  const stop = startScheduler({ clientId, db, redis, mode, intervalMs })

  const shutdown = async (signal: string) => {
    console.log('[optimizer-worker] shutting down', { signal })
    stop()
    await Promise.allSettled([redis.quit(), pool.end()])
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((err) => {
  console.error('[optimizer-worker] fatal', err)
  process.exit(1)
})

