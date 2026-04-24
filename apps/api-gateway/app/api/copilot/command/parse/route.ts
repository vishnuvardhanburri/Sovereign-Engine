import { NextRequest, NextResponse } from 'next/server'
import { parseCommand } from '@/lib/ai/command-parser'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const text = String(body?.text ?? '')
    const parsed = parseCommand(text)
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })
    return NextResponse.json({ ok: true, data: parsed.command })
  } catch (error) {
    console.error('[API] copilot/command/parse failed', error)
    return NextResponse.json({ ok: false, error: 'Failed to parse command' }, { status: 500 })
  }
}

