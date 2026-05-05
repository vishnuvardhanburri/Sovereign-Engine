import crypto from 'node:crypto'
import { query, queryOne } from '@/lib/db'

type EncryptedSecretRow = {
  id: string
  key_version: string
  algorithm: string
  iv: string
  auth_tag: string
  ciphertext: string
}

export type SecretType = 'smtp_credential' | 'api_key' | 'webhook_secret' | 'integration_token'

function keyRing(): Record<string, Buffer> {
  const ring: Record<string, Buffer> = {}
  const rawRing = process.env.SECRET_MASTER_KEYS
  if (rawRing) {
    try {
      const parsed = JSON.parse(rawRing) as Record<string, string>
      for (const [version, raw] of Object.entries(parsed)) {
        ring[version] = decodeKey(raw)
      }
    } catch {
      throw new Error('SECRET_MASTER_KEYS must be a JSON object of version => base64/hex key')
    }
  }

  const current = process.env.SECRET_MASTER_KEY
  if (current) {
    ring[currentKeyVersion()] = decodeKey(current)
  }

  return ring
}

function currentKeyVersion() {
  return process.env.SECRET_MASTER_KEY_ID || 'v1'
}

function decodeKey(raw: string) {
  const value = raw.trim()
  const candidates = [
    Buffer.from(value, 'base64'),
    /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.alloc(0),
    Buffer.from(value, 'utf8'),
  ]
  const key = candidates.find((candidate) => candidate.length === 32)
  if (!key) {
    throw new Error('Secret master key must decode to 32 bytes for AES-256-GCM')
  }
  return key
}

export function isSecretVaultConfigured() {
  return Object.keys(keyRing()).length > 0
}

export function encryptSecret(plaintext: string, aad: string) {
  const keys = keyRing()
  const keyVersion = currentKeyVersion()
  const key = keys[keyVersion]
  if (!key) throw new Error(`Current key version ${keyVersion} is not present in SECRET_MASTER_KEYS/SECRET_MASTER_KEY`)

  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return {
    keyVersion,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
}

export function decryptSecret(row: Pick<EncryptedSecretRow, 'key_version' | 'algorithm' | 'iv' | 'auth_tag' | 'ciphertext'>, aad: string) {
  if (row.algorithm !== 'aes-256-gcm') throw new Error(`Unsupported secret algorithm: ${row.algorithm}`)
  const key = keyRing()[row.key_version]
  if (!key) throw new Error(`Missing secret master key version: ${row.key_version}`)

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(row.iv, 'base64'))
  decipher.setAAD(Buffer.from(aad, 'utf8'))
  decipher.setAuthTag(Buffer.from(row.auth_tag, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(row.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

export async function storeEncryptedSecret(input: {
  clientId?: number | null
  secretType: SecretType
  resourceType: string
  resourceId: string | number
  plaintext: string
  createdBy?: string | null
}) {
  const aad = `${input.clientId ?? 'global'}:${input.secretType}:${input.resourceType}:${input.resourceId}`
  const encrypted = encryptSecret(input.plaintext, aad)
  const result = await query<{ id: string }>(
    `INSERT INTO encrypted_secrets (
       client_id,
       secret_type,
       resource_type,
       resource_id,
       key_version,
       algorithm,
       iv,
       auth_tag,
       ciphertext,
       created_by
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id`,
    [
      input.clientId ?? null,
      input.secretType,
      input.resourceType,
      String(input.resourceId),
      encrypted.keyVersion,
      encrypted.algorithm,
      encrypted.iv,
      encrypted.authTag,
      encrypted.ciphertext,
      input.createdBy ?? 'system',
    ]
  )
  return result.rows[0]!
}

export async function loadEncryptedSecret(input: {
  clientId?: number | null
  secretType: SecretType
  resourceType: string
  resourceId: string | number
}) {
  const row = await queryOne<EncryptedSecretRow>(
    `SELECT id, key_version, algorithm, iv, auth_tag, ciphertext
     FROM encrypted_secrets
     WHERE (client_id = $1 OR ($1::bigint IS NULL AND client_id IS NULL))
       AND secret_type = $2
       AND resource_type = $3
       AND resource_id = $4
       AND status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`,
    [input.clientId ?? null, input.secretType, input.resourceType, String(input.resourceId)]
  )
  if (!row) return null
  const aad = `${input.clientId ?? 'global'}:${input.secretType}:${input.resourceType}:${input.resourceId}`
  return decryptSecret(row, aad)
}

export async function rotateEncryptedSecrets() {
  const targetVersion = currentKeyVersion()
  const rows = await query<EncryptedSecretRow & {
    client_id: string | number | null
    secret_type: SecretType
    resource_type: string
    resource_id: string
  }>(
    `SELECT id, client_id, secret_type, resource_type, resource_id, key_version, algorithm, iv, auth_tag, ciphertext
     FROM encrypted_secrets
     WHERE status = 'active'
       AND key_version <> $1`,
    [targetVersion]
  )

  let rotated = 0
  for (const row of rows.rows) {
    const clientId = row.client_id == null ? null : Number(row.client_id)
    const aad = `${clientId ?? 'global'}:${row.secret_type}:${row.resource_type}:${row.resource_id}`
    const plaintext = decryptSecret(row, aad)
    const encrypted = encryptSecret(plaintext, aad)
    await query(
      `UPDATE encrypted_secrets
       SET key_version = $2,
           algorithm = $3,
           iv = $4,
           auth_tag = $5,
           ciphertext = $6,
           rotated_at = now()
       WHERE id = $1`,
      [row.id, encrypted.keyVersion, encrypted.algorithm, encrypted.iv, encrypted.authTag, encrypted.ciphertext]
    )
    rotated += 1
  }
  return { scanned: rows.rows.length, rotated, targetVersion }
}
