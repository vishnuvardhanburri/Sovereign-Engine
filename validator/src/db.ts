import { Pool } from 'pg'
import { validatorEnv } from './config'

let pool: Pool | null = null

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: validatorEnv.databaseUrl() })
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

