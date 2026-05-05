import crypto from 'node:crypto'

export type SessionClaims = {
  user_id: number
  email: string
  client_id: number
  iat: number
  exp: number
}

const COOKIE_NAME = 'xo_session'

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

function unbase64url(input: string): Buffer {
  const padded = input.replaceAll('-', '+').replaceAll('_', '/')
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
  return Buffer.from(padded + pad, 'base64')
}

function sign(secret: string, payloadB64: string): string {
  return base64url(crypto.createHmac('sha256', secret).update(payloadB64).digest())
}

export function getSessionCookieName(): string {
  return COOKIE_NAME
}

export function createSessionToken(
  secret: string,
  claims: Omit<SessionClaims, 'exp' | 'iat'> & { ttlSeconds?: number; iat?: number }
): string {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + Math.max(60, claims.ttlSeconds ?? 60 * 60 * 24 * 7)
  const body: SessionClaims = {
    user_id: claims.user_id,
    email: claims.email,
    client_id: claims.client_id,
    iat: claims.iat ?? now,
    exp,
  }
  const payloadB64 = base64url(JSON.stringify(body))
  const sig = sign(secret, payloadB64)
  return `${payloadB64}.${sig}`
}

export function verifySessionToken(secret: string, token: string): SessionClaims | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [payloadB64, sig] = parts
  if (!payloadB64 || !sig) return null
  const expected = sign(secret, payloadB64)
  const expectedBuf = Buffer.from(expected)
  const sigBuf = Buffer.from(sig)
  if (expectedBuf.length !== sigBuf.length) return null
  const ok = crypto.timingSafeEqual(expectedBuf, sigBuf)
  if (!ok) return null
  try {
    const payload = JSON.parse(unbase64url(payloadB64).toString('utf8')) as SessionClaims
    if (!payload || typeof payload.exp !== 'number') return null
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    if (typeof payload.user_id !== 'number' || typeof payload.client_id !== 'number' || typeof payload.email !== 'string') return null
    if (typeof payload.iat !== 'number') payload.iat = 0
    return payload
  } catch {
    return null
  }
}
