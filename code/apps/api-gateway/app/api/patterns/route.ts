import { NextResponse } from 'next/server'
import { loadPatternStore } from '@/lib/ai/pattern-memory'

export async function GET() {
  try {
    const store = await loadPatternStore()
    const patterns = store.patterns
      .slice()
      .sort((a, b) => (b.score - a.score) || (b.reply_rate - a.reply_rate) || (b.open_rate - a.open_rate))

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      data: patterns,
    })
  } catch (error) {
    console.error('[API] Failed to load patterns', error)
    return NextResponse.json({ error: 'Failed to load patterns' }, { status: 500 })
  }
}

