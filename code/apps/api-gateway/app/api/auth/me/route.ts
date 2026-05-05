import { NextRequest, NextResponse } from 'next/server'
import { appEnv } from '@/lib/env'
import { getSessionCookieName, verifySessionToken } from '@/lib/auth/session'
import { isSessionRevoked } from '@/lib/auth/revocation'

export async function GET(request: NextRequest) {
  const token = request.cookies.get(getSessionCookieName())?.value ?? ''
  const claims = token ? verifySessionToken(appEnv.authSecret(), token) : null
  if (!claims || await isSessionRevoked(claims)) {
    return NextResponse.json({ user: null }, { status: 200 })
  }
  return NextResponse.json({ user: { id: claims.user_id, email: claims.email, client_id: claims.client_id } }, { status: 200 })
}
