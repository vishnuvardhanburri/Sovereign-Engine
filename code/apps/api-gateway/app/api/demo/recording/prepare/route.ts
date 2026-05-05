import { NextRequest, NextResponse } from 'next/server'
import { resolveClientId } from '@/lib/client-context'
import { startBuyerDemo } from '@/lib/buyer-demo'
import { recordAuditLog } from '@/lib/security/audit-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const clientId = await resolveClientId({ body, headers: request.headers })
    const demo = await startBuyerDemo({ request, clientId })

    await recordAuditLog({
      request,
      clientId,
      actionType: 'recording.prepare',
      resourceType: 'demo_workspace',
      resourceId: `client:${clientId}`,
      details: {
        recording_mode: true,
        recommended_sequence: ['/dashboard', '/reputation', '/proof', '/setup', '/activity', '/handoff'],
      },
    })

    return NextResponse.json({
      ok: true,
      clientId,
      demo,
      recordingMode: true,
      open: '/dashboard?recording=1',
      sequence: ['/dashboard', '/reputation', '/proof', '/setup', '/activity', '/handoff'],
    })
  } catch (error) {
    console.error('[api/demo/recording/prepare] failed', error)
    return NextResponse.json({ ok: false, error: 'Failed to prepare recording demo' }, { status: 500 })
  }
}
