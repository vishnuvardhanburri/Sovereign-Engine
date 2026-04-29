import { NextRequest, NextResponse } from 'next/server'
import { revokeSessions } from '@/lib/auth/revocation'

function requireKillSwitchToken(request: NextRequest): boolean {
  const configured = process.env.SECURITY_KILL_SWITCH_TOKEN
  if (!configured) return false
  const header = request.headers.get('x-kill-switch-token')
  const auth = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  return header === configured || auth === configured
}

export async function POST(request: NextRequest) {
  try {
    if (!requireKillSwitchToken(request)) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const clientIdRaw = body.client_id ?? body.clientId
    let clientId: number | null = null
    if (clientIdRaw != null) {
      const parsedClientId = Number(clientIdRaw)
      if (!Number.isFinite(parsedClientId) || parsedClientId <= 0) {
        return NextResponse.json({ ok: false, error: 'client_id must be a positive number' }, { status: 400 })
      }
      clientId = parsedClientId
    }

    const reason = String(body.reason ?? 'security_kill_switch').slice(0, 500)
    await revokeSessions({
      clientId,
      reason,
      createdBy: 'api_kill_switch',
    })

    return NextResponse.json({
      ok: true,
      scope: clientId ? 'client' : 'global',
      clientId,
      reason,
      message: clientId
        ? `All existing session tokens for client ${clientId} are revoked.`
        : 'All existing session tokens for all clients are revoked.',
    })
  } catch (error) {
    console.error('[api/security/kill-switch] failed', error)
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 })
  }
}
