import { NextRequest, NextResponse } from 'next/server'
import { collectOperationalTelemetry } from '@/lib/observability/autonomous-telemetry'

export async function GET(request: NextRequest) {
  const clientId = Number(request.nextUrl.searchParams.get('client_id') ?? 1)
  const telemetry = await collectOperationalTelemetry(clientId)
  return NextResponse.json({ ok: true, clientId, telemetry })
}
