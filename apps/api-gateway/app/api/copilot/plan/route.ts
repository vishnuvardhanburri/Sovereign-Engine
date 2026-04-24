import { NextResponse } from 'next/server'
import { proposePlan } from '@/lib/ai/orchestrator'

export async function GET() {
  try {
    const plan = await proposePlan()
    return NextResponse.json({ ok: true, data: plan })
  } catch (error) {
    console.error('[API] copilot/plan failed', error)
    // Never 500 on demo paths: return valid JSON and a stable shape.
    return NextResponse.json({
      ok: false,
      error: 'Failed to build copilot plan',
      details: error instanceof Error ? error.message : String(error),
      data: null,
    })
  }
}
