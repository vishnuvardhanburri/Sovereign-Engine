import { NextRequest, NextResponse } from 'next/server'
import { appEnv } from '@/lib/env'
import { runDailyScheduler } from '@/lib/agents/execution/scheduler'

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${appEnv.cronSecret()}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const result = await runDailyScheduler()

    return NextResponse.json({
      ...result,
      telegram_reports: result.reports?.map((report) => ({
        client: report.client.name,
        delivered: report.delivery?.delivered,
      })),
    })
  } catch (error) {
    console.error('[API] Failed to run daily reset', error)
    return NextResponse.json({ error: 'Failed to run daily reset' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: 'daily-reset',
  })
}
