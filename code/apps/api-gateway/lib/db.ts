import { Pool, PoolClient, QueryResult } from 'pg'
import { appEnv } from '@/lib/env'

let pool: Pool | undefined

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: appEnv.databaseUrl(),
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl:
        process.env.NODE_ENV === 'production'
          ? { rejectUnauthorized: false }
          : undefined,
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
