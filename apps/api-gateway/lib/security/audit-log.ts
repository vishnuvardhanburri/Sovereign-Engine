import crypto from 'node:crypto'
import type { NextRequest } from 'next/server'
import { appEnv } from '@/lib/env'
import { transaction } from '@/lib/db'
import { getSessionCookieName, verifySessionToken } from '@/lib/auth/session'

type AuditActionInput = {
  actorId?: string | number | null
  actorType?: 'user' | 'system' | 'api_key' | 'anonymous'
  clientId?: number | null
  actionType: string
  resourceType: string
  resourceId: string | number
  details?: Record<string, unknown>
  ipAddress?: string | null
  userAgent?: string | null
  requestId?: string | null
  serviceName?: string
  request?: NextRequest
}

type AuditChainRow = {
  entry_hash: string | null
}

const REDACTED = '[redacted]'
const EMAIL_REDACTED = '[email-redacted]'
const SENSITIVE_KEY_RE = /(password|pass|secret|token|smtp|authorization|cookie|api[_-]?key|credential|private)/i
const EMAIL_KEY_RE = /(^email$|_email$|email_|recipient|to$|from$)/i
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`)
    .join(',')}}`
}

function sanitizeValue(value: unknown): unknown {
  if (value == null) return value
  if (typeof value === 'string') return value.replace(EMAIL_RE, EMAIL_REDACTED).slice(0, 20_000)
  if (Array.isArray(value)) return value.map(sanitizeValue)
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => {
        if (SENSITIVE_KEY_RE.test(key)) return [key, REDACTED]
        if (EMAIL_KEY_RE.test(key)) return [key, EMAIL_REDACTED]
        return [key, sanitizeValue(nested)]
      })
    )
  }
  return value
}

export function auditRequestContext(request: NextRequest) {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const realIp = request.headers.get('x-real-ip')?.trim()
  const cfIp = request.headers.get('cf-connecting-ip')?.trim()
  return {
    ipAddress: forwardedFor || realIp || cfIp || null,
    userAgent: request.headers.get('user-agent') || null,
    requestId:
      request.headers.get('x-request-id') ||
      request.headers.get('x-amzn-trace-id') ||
      crypto.randomUUID(),
  }
}

export function auditActorFromRequest(request: NextRequest): {
  actorId: string
  actorType: 'user' | 'anonymous'
  clientId: number | null
} {
  const token = request.cookies.get(getSessionCookieName())?.value ?? ''
  const claims = token ? verifySessionToken(appEnv.authSecret(), token) : null
  if (!claims) {
    return { actorId: 'anonymous', actorType: 'anonymous', clientId: null }
  }
  return {
    actorId: String(claims.user_id),
    actorType: 'user',
    clientId: claims.client_id,
  }
}

export function hashActorHint(value: string) {
  return sha256(String(value || '').trim().toLowerCase()).slice(0, 24)
}

export async function recordAuditLog(input: AuditActionInput): Promise<void> {
  const reqContext = input.request ? auditRequestContext(input.request) : null
  const reqActor = input.request ? auditActorFromRequest(input.request) : null
  const timestampUtc = new Date().toISOString()
  const actorId = String(input.actorId ?? reqActor?.actorId ?? 'system')
  const actorType = input.actorType ?? reqActor?.actorType ?? 'system'
  const clientId = input.clientId ?? reqActor?.clientId ?? null
  const ipAddress = input.ipAddress ?? reqContext?.ipAddress ?? null
  const userAgent = input.userAgent ?? reqContext?.userAgent ?? null
  const requestId = input.requestId ?? reqContext?.requestId ?? null
  const details = sanitizeValue(input.details ?? {}) as Record<string, unknown>
  const serviceName = input.serviceName ?? process.env.SERVICE_NAME ?? 'api-gateway'
  const numericUserId = /^\d+$/.test(actorId) ? Number(actorId) : null

  try {
    await transaction(async (exec) => {
      await exec(`LOCK TABLE audit_logs IN SHARE ROW EXCLUSIVE MODE`)
      const previous = await exec<AuditChainRow>(
        `SELECT entry_hash
         FROM audit_logs
         WHERE entry_hash IS NOT NULL
         ORDER BY timestamp_utc DESC NULLS LAST, timestamp DESC NULLS LAST, id DESC
         LIMIT 1`
      )
      const previousHash = previous.rows[0]?.entry_hash ?? ''
      const canonical = stableJson({
        previousHash,
        timestampUtc,
        actorId,
        actorType,
        clientId,
        actionType: input.actionType,
        resourceType: input.resourceType,
        resourceId: String(input.resourceId),
        ipAddress,
        userAgent,
        requestId,
        serviceName,
        details,
      })
      const entryHash = sha256(canonical)

      await exec(
        `INSERT INTO audit_logs (
           id,
           user_id,
           client_id,
           actor_id,
           actor_type,
           action,
           action_type,
           resource_type,
           resource_id,
           details,
           ip_address,
           user_agent,
           timestamp,
           timestamp_utc,
           previous_hash,
           entry_hash,
           request_id,
           service_name
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13::timestamptz,$13::timestamptz,$14,$15,$16,$17)`,
        [
          crypto.randomUUID(),
          numericUserId,
          clientId,
          actorId,
          actorType,
          input.actionType,
          input.actionType,
          input.resourceType,
          String(input.resourceId),
          JSON.stringify(details),
          ipAddress,
          userAgent,
          timestampUtc,
          previousHash,
          entryHash,
          requestId,
          serviceName,
        ]
      )
    })
  } catch (error) {
    console.warn('[audit-log] append failed', {
      actionType: input.actionType,
      resourceType: input.resourceType,
      err: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function verifyAuditChain(limit = 500): Promise<{
  checked: number
  valid: boolean
  brokenAtId: string | null
}> {
  const rows = await transaction(async (exec) => {
    const result = await exec<{
      id: string
      previous_hash: string | null
      entry_hash: string | null
      timestamp_utc: string | null
    }>(
      `SELECT id, previous_hash, entry_hash, timestamp_utc
       FROM audit_logs
       WHERE entry_hash IS NOT NULL
       ORDER BY timestamp_utc ASC NULLS LAST, timestamp ASC NULLS LAST, id ASC
       LIMIT $1`,
      [Math.max(1, Math.min(limit, 10_000))]
    )
    return result.rows
  })

  let previous = ''
  for (const row of rows) {
    if ((row.previous_hash ?? '') !== previous) {
      return { checked: rows.length, valid: false, brokenAtId: row.id }
    }
    previous = row.entry_hash ?? ''
  }

  return { checked: rows.length, valid: true, brokenAtId: null }
}
