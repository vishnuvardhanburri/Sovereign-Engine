import { NextResponse } from 'next/server'
import { buildSystemGuarantees } from '@/lib/ai/guarantees'

export async function GET() {
  try {
    const snapshot = await buildSystemGuarantees()
    return NextResponse.json({ ok: true, data: snapshot })
  } catch (error) {
    console.error('[API] copilot/guarantees failed', error)
    return NextResponse.json({ ok: false, error: 'Failed to build guarantees snapshot' }, { status: 500 })
  }
}

