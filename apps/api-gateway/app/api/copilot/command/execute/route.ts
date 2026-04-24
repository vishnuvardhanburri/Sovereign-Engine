import { NextRequest, NextResponse } from 'next/server'
import { executeApprovedAction } from '@/lib/ai/orchestrator'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const planId = String(body.planId ?? body.proposalId ?? '')
    const actionId = String(body.actionId ?? '')
    const approve = Boolean(body.approve)

    if (!planId || !actionId) {
      return NextResponse.json({ ok: false, error: 'planId and actionId are required' }, { status: 400 })
    }
    if (!approve) {
      return NextResponse.json({ ok: false, error: 'Explicit approve=true is required to execute writes' }, { status: 400 })
    }

    const result = await executeApprovedAction({ proposalId: planId, actionId, approve: true })
    if (!result.ok) return NextResponse.json(result, { status: 400 })
    return NextResponse.json(result)
  } catch (error) {
    console.error('[API] copilot/command/execute failed', error)
    return NextResponse.json({ ok: false, error: 'Failed to execute command action' }, { status: 500 })
  }
}

