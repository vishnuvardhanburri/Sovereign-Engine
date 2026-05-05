import { NextRequest, NextResponse } from 'next/server'
import { buildProductionReadinessReport } from '@/lib/setup-readiness'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const report = await buildProductionReadinessReport({
      domain: searchParams.get('domain'),
      smtpHost: searchParams.get('smtp_host'),
    })

    return NextResponse.json(report)
  } catch (error) {
    console.error('[api/setup/readiness] failed', error)
    return NextResponse.json(
      { ok: false, error: 'Failed to build readiness report' },
      { status: 500 }
    )
  }
}
