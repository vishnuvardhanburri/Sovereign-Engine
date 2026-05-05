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

type AuditAnchor = {
  id: string
  scope: string
  head_hash: string
  head_log_id: string | null
  log_count: string
  previous_anchor_hash: string | null
  anchor_hash: string
  created_at: string
  service_name: string
}

const AUDIT_HASH_VERSION = 'audit-v2'
const AUDIT_HASH_ALGORITHM = 'sha256'
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

function buildCanonicalPayload(input: {
  previousHash: string
  timestampUtc: string
  actorId: string
  actorType: string
  clientId: number | null
  actionType: string
  resourceType: string
  resourceId: string
  ipAddress: string | null
  userAgent: string | null
  requestId: string | null
  serviceName: string
  details: Record<string, unknown>
}) {
  return {
    hashVersion: AUDIT_HASH_VERSION,
    hashAlgorithm: AUDIT_HASH_ALGORITHM,
    previousHash: input.previousHash,
    timestampUtc: input.timestampUtc,
    actorId: input.actorId,
    actorType: input.actorType,
    clientId: input.clientId,
    actionType: input.actionType,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    requestId: input.requestId,
    serviceName: input.serviceName,
    details: input.details,
  }
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
      const canonicalPayload = buildCanonicalPayload({
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
      const canonical = stableJson(canonicalPayload)
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
           hash_version,
           chain_hash_algorithm,
           canonical_payload,
           request_id,
           service_name
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13::timestamptz,$13::timestamptz,$14,$15,$16,$17,$18::jsonb,$19,$20)`,
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
          AUDIT_HASH_VERSION,
          AUDIT_HASH_ALGORITHM,
          JSON.stringify(canonicalPayload),
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
  hashVerified: number
  legacyChecked: number
  valid: boolean
  brokenAtId: string | null
  brokenReason: string | null
}> {
  const rows = await transaction(async (exec) => {
    const result = await exec<{
      id: string
      previous_hash: string | null
      entry_hash: string | null
      hash_version: string | null
      chain_hash_algorithm: string | null
      canonical_payload: Record<string, unknown> | null
      timestamp_utc: string | null
    }>(
      `SELECT
         id,
         previous_hash,
         entry_hash,
         hash_version,
         chain_hash_algorithm,
         canonical_payload,
         timestamp_utc
       FROM audit_logs
       WHERE entry_hash IS NOT NULL
       ORDER BY timestamp_utc ASC NULLS LAST, timestamp ASC NULLS LAST, id ASC
       LIMIT $1`,
      [Math.max(1, Math.min(limit, 10_000))]
    )
    return result.rows
  })

  let previous = ''
  let hashVerified = 0
  let legacyChecked = 0

  for (const row of rows) {
    if ((row.previous_hash ?? '') !== previous) {
      return {
        checked: rows.length,
        hashVerified,
        legacyChecked,
        valid: false,
        brokenAtId: row.id,
        brokenReason: 'previous_hash_mismatch',
      }
    }

    if (row.canonical_payload) {
      const payloadPreviousHash = String(row.canonical_payload.previousHash ?? '')
      const payloadHashVersion = String(row.canonical_payload.hashVersion ?? '')
      const payloadAlgorithm = String(row.canonical_payload.hashAlgorithm ?? '')
      const storedAlgorithm = row.chain_hash_algorithm ?? payloadAlgorithm
      const storedVersion = row.hash_version ?? payloadHashVersion

      if (payloadPreviousHash !== previous) {
        return {
          checked: rows.length,
          hashVerified,
          legacyChecked,
          valid: false,
          brokenAtId: row.id,
          brokenReason: 'canonical_previous_hash_mismatch',
        }
      }

      if (storedAlgorithm !== AUDIT_HASH_ALGORITHM || payloadAlgorithm !== AUDIT_HASH_ALGORITHM) {
        return {
          checked: rows.length,
          hashVerified,
          legacyChecked,
          valid: false,
          brokenAtId: row.id,
          brokenReason: 'unsupported_hash_algorithm',
        }
      }

      if (storedVersion !== AUDIT_HASH_VERSION || payloadHashVersion !== AUDIT_HASH_VERSION) {
        return {
          checked: rows.length,
          hashVerified,
          legacyChecked,
          valid: false,
          brokenAtId: row.id,
          brokenReason: 'unsupported_hash_version',
        }
      }

      const recomputedHash = sha256(stableJson(row.canonical_payload))
      if (recomputedHash !== row.entry_hash) {
        return {
          checked: rows.length,
          hashVerified,
          legacyChecked,
          valid: false,
          brokenAtId: row.id,
          brokenReason: 'entry_hash_mismatch',
        }
      }
      hashVerified += 1
    } else {
      legacyChecked += 1
    }

    previous = row.entry_hash ?? ''
  }

  return {
    checked: rows.length,
    hashVerified,
    legacyChecked,
    valid: true,
    brokenAtId: null,
    brokenReason: null,
  }
}

export async function createAuditChainAnchor(scope = 'global'): Promise<{
  id: string
  scope: string
  headHash: string
  logCount: number
  anchorHash: string
}> {
  return transaction(async (exec) => {
    await exec(`LOCK TABLE audit_chain_anchors IN SHARE ROW EXCLUSIVE MODE`)
    const head = await exec<{ head_log_id: string | null; head_hash: string | null; log_count: string }>(
      `SELECT
         (
           SELECT id
           FROM audit_logs
           WHERE entry_hash IS NOT NULL
           ORDER BY timestamp_utc DESC NULLS LAST, timestamp DESC NULLS LAST, id DESC
           LIMIT 1
         ) AS head_log_id,
         (
           SELECT entry_hash
           FROM audit_logs
           WHERE entry_hash IS NOT NULL
           ORDER BY timestamp_utc DESC NULLS LAST, timestamp DESC NULLS LAST, id DESC
           LIMIT 1
         ) AS head_hash,
         COUNT(*)::text AS log_count
       FROM audit_logs
       WHERE entry_hash IS NOT NULL`
    )
    const previousAnchor = await exec<{ anchor_hash: string }>(
      `SELECT anchor_hash
       FROM audit_chain_anchors
       WHERE scope = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [scope]
    )

    const headRow = head.rows[0]
    const headHash = headRow?.head_hash ?? ''
    const headLogId = headRow?.head_log_id ?? null
    const logCount = Number(headRow?.log_count ?? 0)
    const previousAnchorHash = previousAnchor.rows[0]?.anchor_hash ?? ''
    const serviceName = process.env.SERVICE_NAME ?? 'api-gateway'
    const createdAt = new Date().toISOString()
    const canonicalAnchor = {
      hashVersion: AUDIT_HASH_VERSION,
      hashAlgorithm: AUDIT_HASH_ALGORITHM,
      scope,
      headHash,
      headLogId,
      logCount,
      previousAnchorHash,
      createdAt,
      serviceName,
    }
    const anchorHash = sha256(stableJson(canonicalAnchor))

    const result = await exec<{ id: string }>(
      `INSERT INTO audit_chain_anchors (
         scope,
         head_hash,
         head_log_id,
         log_count,
         previous_anchor_hash,
         anchor_hash,
         created_at,
         service_name
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8)
       RETURNING id::text`,
      [scope, headHash, headLogId, logCount, previousAnchorHash, anchorHash, createdAt, serviceName]
    )

    return {
      id: result.rows[0]?.id ?? '',
      scope,
      headHash,
      logCount,
      anchorHash,
    }
  })
}

export async function getLatestAuditChainAnchor(scope = 'global'): Promise<AuditAnchor | null> {
  return transaction(async (exec) => {
    const result = await exec<AuditAnchor>(
      `SELECT
         id::text,
         scope,
         head_hash,
         head_log_id,
         log_count::text,
         previous_anchor_hash,
         anchor_hash,
         created_at::text,
         service_name
       FROM audit_chain_anchors
       WHERE scope = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [scope]
    )
    return result.rows[0] ?? null
  })
}
