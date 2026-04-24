import { NextResponse } from 'next/server'
import { getSessionCookieName } from '@/lib/auth/session'

export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(getSessionCookieName(), '', { httpOnly: true, path: '/', maxAge: 0 })
  return res
}

