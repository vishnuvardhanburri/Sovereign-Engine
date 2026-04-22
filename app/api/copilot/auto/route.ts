import { NextResponse } from 'next/server'
import { executeIfAutonomousSafe } from '@/lib/ai/orchestrator'

export async function POST() {
  try {
    const result = await executeIfAutonomousSafe({})
    return NextResponse.json(result)
  } catch (error) {
    console.error('[API] copilot/auto failed', error)
    return NextResponse.json({ ok: false, error: 'Autonomous tick failed' }, { status: 500 })
  }
}

