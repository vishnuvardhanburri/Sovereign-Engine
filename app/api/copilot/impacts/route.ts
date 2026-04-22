import { NextRequest, NextResponse } from 'next/server'
import { listImpacts, summarizeImpact } from '@/lib/ai/impact'
import { demoImpactsPayload, isDemoModeEnabled } from '@/lib/demo-mode'

export async function GET(req: NextRequest) {
  try {
    const limit = Math.max(1, Math.min(25, Number(req.nextUrl.searchParams.get('limit') ?? 10) || 10))

    if (isDemoModeEnabled()) {
      return NextResponse.json(demoImpactsPayload(limit))
    }

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
    // Never 500 on demo paths.
    return NextResponse.json({
      ok: false,
      error: 'Failed to load impacts',
      details: error instanceof Error ? error.message : String(error),
      data: [],
    })
  }
}
