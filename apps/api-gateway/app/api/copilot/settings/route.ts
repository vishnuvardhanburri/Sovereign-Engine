import { NextRequest, NextResponse } from 'next/server'
import { getCopilotSettings, setAutonomousMode } from '@/lib/ai/settings'

export async function GET() {
  try {
    const settings = await getCopilotSettings()
    return NextResponse.json({ ok: true, data: settings })
  } catch (error) {
    console.error('[API] copilot/settings GET failed', error)
    return NextResponse.json({ ok: false, error: 'Failed to load copilot settings' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const autonomousMode = Boolean(body.autonomousMode)
    const updated = await setAutonomousMode({ autonomousMode })
    return NextResponse.json({ ok: true, data: updated })
  } catch (error) {
    console.error('[API] copilot/settings POST failed', error)
    return NextResponse.json({ ok: false, error: 'Failed to update copilot settings' }, { status: 500 })
  }
}

