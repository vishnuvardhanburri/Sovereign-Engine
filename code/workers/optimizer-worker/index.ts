import 'dotenv/config'
import IORedis from 'ioredis'
import { Pool, type PoolConfig } from 'pg'
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

function boundedIntEnv(name: string, def: number, min: number, max: number) {
  return Math.min(max, Math.max(min, intEnv(name, def)))
}

function boolEnv(name: string, fallback = false) {
  const value = process.env[name]
  if (!value) return fallback
  return value === '1' || value.toLowerCase() === 'true' || value.toLowerCase() === 'yes'
}

function pgSsl(connectionString: string): PoolConfig['ssl'] {
  try {
    const sslmode = new URL(connectionString).searchParams.get('sslmode')?.toLowerCase()
    if (sslmode === 'disable') return undefined
    if (sslmode === 'require' || sslmode === 'verify-ca' || sslmode === 'verify-full') {
      return { rejectUnauthorized: boolEnv('PG_SSL_REJECT_UNAUTHORIZED', false) }
    }
  } catch {}

  return process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
}

function pgConnectionString(connectionString: string) {
  try {
    const url = new URL(connectionString)
    const sslmode = url.searchParams.get('sslmode')?.toLowerCase()
    if (sslmode && sslmode !== 'disable') {
      url.searchParams.delete('sslmode')
      return url.toString()
    }
  } catch {}
  return connectionString
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

  const databaseUrl = reqEnv('DATABASE_URL')
  const pool = new Pool({
    connectionString: pgConnectionString(databaseUrl),
    max: boundedIntEnv('PG_POOL_MAX', 2, 1, 10),
    idleTimeoutMillis: boundedIntEnv('PG_POOL_IDLE_TIMEOUT_MS', 30_000, 1_000, 10 * 60_000),
    connectionTimeoutMillis: boundedIntEnv('PG_POOL_CONNECTION_TIMEOUT_MS', 5_000, 500, 60_000),
    ssl: pgSsl(databaseUrl),
  })
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
