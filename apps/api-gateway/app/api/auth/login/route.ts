import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { appEnv } from '@/lib/env'
import { createSessionToken, getSessionCookieName } from '@/lib/auth/session'
import { verifyPassword } from '@/lib/auth/password'
import { hashActorHint, recordAuditLog } from '@/lib/security/audit-log'

type LoginBody = {
  email?: string
  password?: string
}

function shouldUseSecureCookie() {
  const appProtocol = (process.env.APP_PROTOCOL || '').trim().toLowerCase()
  const appBaseUrl = (process.env.APP_BASE_URL || '').trim().toLowerCase()
  if (appProtocol === 'http' || appBaseUrl.startsWith('http://')) return false
  return process.env.NODE_ENV === 'production'
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as LoginBody
    const email = String(body.email ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')
    if (!email || !password) {
      return NextResponse.json({ error: 'email and password are required' }, { status: 400 })
    }

    const user = await query<{ id: number | string; email: string; password_hash: string | null }>(
      `SELECT id, email, password_hash FROM users WHERE email = $1 LIMIT 1`,
      [email]
    )
    const row = user.rows[0]
    if (!row?.password_hash || !verifyPassword(password, row.password_hash)) {
      await recordAuditLog({
        request,
        actorId: `email:${hashActorHint(email)}`,
        actorType: 'anonymous',
        actionType: 'auth.login.failure',
        resourceType: 'session',
        resourceId: 'login',
        details: { email_hash: hashActorHint(email), reason: 'invalid_credentials' },
      })
      return NextResponse.json({ error: 'invalid credentials' }, { status: 401 })
    }

    const userId = Number(row.id)
    if (!Number.isSafeInteger(userId)) {
      return NextResponse.json({ error: 'invalid user id' }, { status: 500 })
    }

    const clientId = appEnv.defaultClientId()
    const token = createSessionToken(appEnv.authSecret(), { user_id: userId, email: row.email, client_id: clientId })
    const res = NextResponse.json({ ok: true, user: { id: userId, email: row.email, client_id: clientId } })
    res.cookies.set(getSessionCookieName(), token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: shouldUseSecureCookie(),
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    })
    await recordAuditLog({
      request,
      actorId: userId,
      actorType: 'user',
      clientId,
      actionType: 'auth.login.success',
      resourceType: 'session',
      resourceId: userId,
      details: { user_id: userId, client_id: clientId },
    })
    return res
  } catch (error) {
    console.error('[API] login failed', error)
    return NextResponse.json({ error: 'login failed' }, { status: 500 })
  }
}
