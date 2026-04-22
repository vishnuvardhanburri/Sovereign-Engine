import { NextRequest, NextResponse } from 'next/server'
import { listImpacts, summarizeImpact } from '@/lib/ai/impact'

export async function GET(req: NextRequest) {
  try {
    const limit = Math.max(1, Math.min(25, Number(req.nextUrl.searchParams.get('limit') ?? 10) || 10))
    const impacts = await listImpacts({ limit })
    return NextResponse.json({
      ok: true,
      data: impacts.map((i) => ({
        ...i,
        summaryLines: summarizeImpact(i.before_snapshot, i.after_snapshot),
      })),
    })
  } catch (error) {
    console.error('[API] copilot/impacts failed', error)
    return NextResponse.json({ ok: false, error: 'Failed to load impacts' }, { status: 500 })
  }
}

