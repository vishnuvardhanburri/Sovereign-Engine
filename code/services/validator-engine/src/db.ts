import { Pool, type PoolConfig } from 'pg'
import { validatorEnv } from './config'

let pool: Pool | null = null

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number.parseInt(String(process.env[name] ?? ''), 10)
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
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

export function getPool(): Pool {
  if (!pool) {
    const databaseUrl = validatorEnv.databaseUrl()
    pool = new Pool({
      connectionString: pgConnectionString(databaseUrl),
      max: intEnv('PG_POOL_MAX', 3, 1, 10),
      idleTimeoutMillis: intEnv('PG_POOL_IDLE_TIMEOUT_MS', 30_000, 1_000, 10 * 60_000),
      connectionTimeoutMillis: intEnv('PG_POOL_CONNECTION_TIMEOUT_MS', 5_000, 500, 60_000),
      ssl: pgSsl(databaseUrl),
    })
  }
  return pool
}

export async function ensureValidatorTables(): Promise<void> {
  const p = getPool()
  await p.query(`
    CREATE TABLE IF NOT EXISTS email_validations (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      normalized_email TEXT NOT NULL,
      domain TEXT NOT NULL,
      verdict TEXT NOT NULL CHECK (verdict IN ('valid','risky','invalid','unknown')),
      score NUMERIC(3,2) NOT NULL,
      reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
      mx JSONB,
      smtp JSONB,
      catch_all JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_email_validations_normalized ON email_validations(normalized_email);
    CREATE INDEX IF NOT EXISTS idx_email_validations_domain ON email_validations(domain);
  `)
}

export async function insertValidation(row: {
  email: string
  normalizedEmail: string
  domain: string
  verdict: string
  score: number
  reasons: string[]
  mx: any
  smtp: any
  catchAll: any
}): Promise<void> {
  const p = getPool()
  await p.query(
    `INSERT INTO email_validations (email, normalized_email, domain, verdict, score, reasons, mx, smtp, catch_all)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      row.email,
      row.normalizedEmail,
      row.domain,
      row.verdict,
      row.score,
      JSON.stringify(row.reasons ?? []),
      JSON.stringify(row.mx ?? null),
      JSON.stringify(row.smtp ?? null),
      JSON.stringify(row.catchAll ?? null),
    ]
  )
}
