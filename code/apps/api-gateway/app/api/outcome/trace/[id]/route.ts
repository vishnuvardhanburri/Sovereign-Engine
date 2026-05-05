import { NextRequest, NextResponse } from 'next/server'
import { appEnv } from '@/lib/env'
import { getSessionCookieName, verifySessionToken } from '@/lib/auth/session'
import { getOutcomeTraceAdapter } from '@/adapters/outcome'

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const token = request.cookies.get(getSessionCookieName())?.value ?? ''
  const claims = token ? verifySessionToken(appEnv.authSecret(), token) : null
  if (!claims) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const clientId = claims.client_id
  const { id } = await ctx.params
  const traceId = String(id || '').trim()
  if (!traceId) {
    return NextResponse.json({ error: 'invalid_trace_id' }, { status: 400 })
  }

  const result = await getOutcomeTraceAdapter({ clientId, traceId })
  return NextResponse.json(result ?? { error: 'not_found' }, { status: result ? 200 : 404 })
}
