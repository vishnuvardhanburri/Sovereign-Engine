import { NextResponse } from 'next/server'
import { getDemoState, getDemoModeStatus } from '@/lib/demo-mode'

export async function GET() {
  try {
    const status = await getDemoModeStatus()
    const state = await getDemoState()
    return NextResponse.json({
      ok: true,
      data: {
        ...status,
        beforeAfter: state.beforeAfter,
        counters: state.counters,
      },
    })
  } catch (error) {
    console.error('[API] demo/state failed', error)
    return NextResponse.json({ ok: false, error: 'Failed to load demo state' }, { status: 500 })
  }
}
