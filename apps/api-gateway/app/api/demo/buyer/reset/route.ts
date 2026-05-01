import { NextRequest, NextResponse } from 'next/server'
import { resolveClientId } from '@/lib/client-context'
import { resetBuyerDemo } from '@/lib/buyer-demo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const clientId = await resolveClientId({ body, headers: request.headers })
    const result = await resetBuyerDemo({ request, clientId })
    return NextResponse.json(result)
  } catch (error) {
    console.error('[api/demo/buyer/reset] failed', error)
    return NextResponse.json({ ok: false, error: 'Failed to reset buyer demo' }, { status: 500 })
  }
}
