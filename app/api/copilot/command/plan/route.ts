import { NextRequest, NextResponse } from 'next/server'
import { parseCommand } from '@/lib/ai/command-parser'
import { buildExecutionPlan } from '@/lib/ai/plan-builder'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const text = String(body?.text ?? '')
    const mode = body?.mode === 'manual' ? 'manual' : 'auto'
    const parsed = parseCommand(text)
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })

    const plan = await buildExecutionPlan({ command: parsed.command, mode })
    if (!plan.ok) return NextResponse.json({ ok: false, error: plan.error }, { status: 400 })

    return NextResponse.json({ ok: true, data: plan.plan })
  } catch (error) {
    console.error('[API] copilot/command/plan failed', error)
    return NextResponse.json({ ok: false, error: 'Failed to build execution plan' }, { status: 500 })
  }
}
