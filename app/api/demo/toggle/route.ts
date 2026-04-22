import { NextRequest, NextResponse } from 'next/server'
import { setDemoModeEnabled } from '@/lib/demo-mode'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const enabled = Boolean((body as any).enabled ?? (body as any).demoMode ?? (body as any).DEMO_MODE)
    const status = setDemoModeEnabled(enabled)
    return NextResponse.json({ ok: true, data: status })
  } catch (error) {
    console.error('[API] demo/toggle failed', error)
    return NextResponse.json({ ok: false, error: 'Failed to toggle demo mode' }, { status: 500 })
  }
}

