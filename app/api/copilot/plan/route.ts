import { NextResponse } from 'next/server'
import { proposePlan } from '@/lib/ai/orchestrator'

export async function GET() {
  try {
    const plan = await proposePlan()
    return NextResponse.json({ ok: true, data: plan })
  } catch (error) {
    console.error('[API] copilot/plan failed', error)
    return NextResponse.json({ ok: false, error: 'Failed to build copilot plan' }, { status: 500 })
  }
}

