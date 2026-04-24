import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { appEnv } from '@/lib/env'
import { createSessionToken, getSessionCookieName } from '@/lib/auth/session'
import { verifyPassword } from '@/lib/auth/password'

type LoginBody = {
  email?: string
  password?: string
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as LoginBody
    const email = String(body.email ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')
    if (!email || !password) {
      return NextResponse.json({ error: 'email and password are required' }, { status: 400 })
    }

    const user = await query<{ id: number; email: string; password_hash: string | null }>(
      `SELECT id, email, password_hash FROM users WHERE email = $1 LIMIT 1`,
      [email]
    )
    const row = user.rows[0]
    if (!row?.password_hash || !verifyPassword(password, row.password_hash)) {
      return NextResponse.json({ error: 'invalid credentials' }, { status: 401 })
    }

    const clientId = appEnv.defaultClientId()
    const token = createSessionToken(appEnv.authSecret(), { user_id: row.id, email: row.email, client_id: clientId })
    const res = NextResponse.json({ ok: true, user: { id: row.id, email: row.email, client_id: clientId } })
    res.cookies.set(getSessionCookieName(), token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    })
    return res
  } catch (error) {
    console.error('[API] login failed', error)
    return NextResponse.json({ error: 'login failed' }, { status: 500 })
  }
}

