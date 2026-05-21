import { NextRequest, NextResponse } from 'next/server'
import { appEnv } from '@/lib/env'
import { getSendingCapacityDiagnosis } from '@/lib/sending-capacity-diagnostics'

function authorize(request: NextRequest): boolean {
  const expected = appEnv.cronSecret()
  const provided =
    request.headers.get('x-cron-secret') ||
    request.nextUrl.searchParams.get('secret') ||
    ''
  return Boolean(expected && provided && provided === expected)
}

function intParam(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(Math.trunc(parsed), max))
}

export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  try {
    const params = request.nextUrl.searchParams
    const clientId = intParam(params.get('client_id') || process.env.DEFAULT_CLIENT_ID || '1', 1, 1, 1_000_000)
    const targetDailyVolume = intParam(
      params.get('targetDailyVolume') ||
        process.env.DAILY_OUTBOUND_TARGET_DAILY_VOLUME ||
        process.env.TARGET_DAILY_VOLUME ||
        process.env.INFRASTRUCTURE_TARGET_DAILY_VOLUME ||
        '800',
      800,
      1,
      1_000_000
    )
    const diagnosis = await getSendingCapacityDiagnosis(clientId, { targetDailyVolume })

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      ...diagnosis,
    })
  } catch (error) {
    console.error('[api/system/capacity] failed', error)
    return NextResponse.json(
      {
        ok: false,
        error: 'failed',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
