import { NextRequest, NextResponse } from 'next/server'
import { runDailyMaintenance } from '@/lib/backend'
import { query } from '@/lib/db'
import { appEnv } from '@/lib/env'
import { runDailyOperatorCycle } from '@/lib/operator'

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${appEnv.cronSecret()}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const result = await runDailyMaintenance()
    const clients = await query<{ id: number }>(
      `SELECT id
       FROM clients
       WHERE operator_enabled = TRUE`
    )

    const reports = []
    for (const client of clients.rows) {
      reports.push(await runDailyOperatorCycle(Number(client.id)))
    }

    return NextResponse.json({
      success: true,
      ...result,
      telegram_reports: reports.map((report) => ({
        client: report.client.name,
        delivered: report.delivery.delivered,
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
