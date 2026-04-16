import { Pool } from 'pg'

// Initialize PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
})

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err)
})

export async function query<T>(
  text: string,
  params?: any[]
): Promise<{ rows: T[]; rowCount: number }> {
  const start = Date.now()
  try {
    const result = await pool.query(text, params)
    const duration = Date.now() - start
    console.log('[DB] Executed query', { duration, rows: result.rowCount })
    return {
      rows: result.rows as T[],
      rowCount: result.rowCount || 0,
    }
  } catch (error) {
    console.error('[DB] Query error:', error, { text, params })
    throw error
  }
}

export async function queryOne<T>(
  text: string,
  params?: any[]
): Promise<T | null> {
  const result = await query<T>(text, params)
  return result.rows[0] || null
}

export async function transaction<T>(
  callback: (query: typeof query) => Promise<T>
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const transactionQuery = async (text: string, params?: any[]) => {
      const result = await client.query(text, params)
      return {
        rows: result.rows,
        rowCount: result.rowCount || 0,
      }
    }
    const result = await callback(transactionQuery as typeof query)
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
  await pool.end()
}

export default pool
