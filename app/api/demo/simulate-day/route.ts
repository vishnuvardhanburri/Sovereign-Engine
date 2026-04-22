import { NextResponse } from 'next/server'
import { simulateOneDay } from '@/lib/demo-mode'

export async function POST() {
  try {
    const res = await simulateOneDay()
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: res.error }, { status: 400 })
    }
    return NextResponse.json({ ok: true, data: { updatedAt: res.state.updatedAt, day: res.state.day } })
  } catch (error) {
    console.error('[API] demo/simulate-day failed', error)
    return NextResponse.json({ ok: false, error: 'Failed to simulate day' }, { status: 500 })
  }
}
