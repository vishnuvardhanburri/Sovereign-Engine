import { query, queryOne } from '@/lib/db'
import type { SessionClaims } from '@/lib/auth/session'

export async function isSessionRevoked(claims: SessionClaims): Promise<boolean> {
  const issuedAt = new Date(Math.max(0, claims.iat) * 1000)
  const row = await queryOne<{ revoked: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM session_revocations
       WHERE (client_id = $1 OR client_id IS NULL)
         AND revoked_after >= $2
     ) AS revoked`,
    [claims.client_id, issuedAt]
  )
  return Boolean(row?.revoked)
}

export async function revokeSessions(input: {
  clientId?: number | null
  reason: string
  createdBy?: string
}): Promise<void> {
  await query(
    `INSERT INTO session_revocations (client_id, reason, created_by)
     VALUES ($1,$2,$3)`,
    [input.clientId ?? null, input.reason, input.createdBy ?? 'kill_switch']
  )
}
