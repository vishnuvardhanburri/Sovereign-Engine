import { Pool, PoolClient, PoolConfig, QueryResult } from 'pg'
import { appEnv } from '@/lib/env'

let pool: Pool | undefined

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number.parseInt(String(process.env[name] ?? ''), 10)
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function boolEnv(name: string, fallback = false): boolean {
  const value = process.env[name]
  if (!value) return fallback
  return value === '1' || value.toLowerCase() === 'true' || value.toLowerCase() === 'yes'
}

function databaseSsl(connectionString: string): PoolConfig['ssl'] {
  try {
    const sslmode = new URL(connectionString).searchParams.get('sslmode')?.toLowerCase()
    if (sslmode === 'disable') return undefined
    if (sslmode === 'require' || sslmode === 'verify-ca' || sslmode === 'verify-full') {
      return { rejectUnauthorized: boolEnv('PG_SSL_REJECT_UNAUTHORIZED', false) }
    }
  } catch {
    // appEnv.databaseUrl validates the URL before this is called.
  }

  if (process.env.NODE_ENV === 'production' || boolEnv('PG_SSL', false)) {
    return { rejectUnauthorized: boolEnv('PG_SSL_REJECT_UNAUTHORIZED', false) }
  }

  return undefined
}

function databaseConnectionString(connectionString: string): string {
  try {
    const url = new URL(connectionString)
    const sslmode = url.searchParams.get('sslmode')?.toLowerCase()
    if (sslmode && sslmode !== 'disable') {
      // node-postgres currently treats sslmode=require like verify-full in some
      // paths, which breaks managed poolers with self-signed chains. We control
      // TLS explicitly through the `ssl` Pool option instead.
      url.searchParams.delete('sslmode')
      return url.toString()
    }
  } catch {
    // appEnv.databaseUrl validates the URL before this is called.
  }

  return connectionString
}

export function getPool(): Pool {
  if (!pool) {
    const connectionString = appEnv.databaseUrl()
    pool = new Pool({
      connectionString: databaseConnectionString(connectionString),
      max: intEnv('PG_POOL_MAX', 5, 1, 20),
      idleTimeoutMillis: intEnv('PG_POOL_IDLE_TIMEOUT_MS', 30_000, 1_000, 10 * 60_000),
      connectionTimeoutMillis: intEnv('PG_POOL_CONNECTION_TIMEOUT_MS', 5_000, 500, 60_000),
      ssl: databaseSsl(connectionString),
    })

    pool.on('error', (error: unknown) => {
      console.error('[DB] Unexpected idle client error', error)
    })
  }

  return pool
}

export interface QueryExecutor {
  <T>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>
}

async function execute<T>(
  client: Pool | PoolClient,
  text: string,
  params?: unknown[]
): Promise<{ rows: T[]; rowCount: number }> {
  const startedAt = Date.now()
  const result: QueryResult = await client.query(text, params)
  const duration = Date.now() - startedAt

  if (duration > 250) {
    console.warn('[DB] Slow query detected', {
      duration,
      statement: text.slice(0, 120),
      rowCount: result.rowCount ?? 0,
    })
  }

  return {
    rows: result.rows as T[],
    rowCount: result.rowCount ?? 0,
  }
}

export async function query<T>(
  text: string,
  params?: unknown[]
): Promise<{ rows: T[]; rowCount: number }> {
  return execute<T>(getPool(), text, params)
}

export async function queryOne<T>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const result = await query<T>(text, params)
  return result.rows[0] ?? null
}

export async function transaction<T>(
  callback: (executor: QueryExecutor) => Promise<T>
): Promise<T> {
  const client = await getPool().connect()

  try {
    await client.query('BEGIN')
    const executor: QueryExecutor = (text, params) => execute(client, text, params)
    const result = await callback(executor)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = undefined
  }
}
