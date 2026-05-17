import { NextRequest, NextResponse } from 'next/server'
import { appEnv } from '@/lib/env'
import { runDailyScheduler } from '@/lib/agents/execution/scheduler'

function getProvidedSecret(request: NextRequest): string {
  const authHeader = request.headers.get('authorization') || ''
  const bearerSecret = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : ''
  return (
    request.headers.get('x-cron-secret') ||
    request.nextUrl.searchParams.get('secret') ||
    bearerSecret ||
    ''
  )
}

function hasCredential(request: NextRequest): boolean {
  return (
    request.headers.has('authorization') ||
    request.headers.has('x-cron-secret') ||
    request.nextUrl.searchParams.has('secret')
  )
}

function authorizeCron(request: NextRequest): boolean {
  const expectedSecret = appEnv.cronSecret()
  const providedSecret = getProvidedSecret(request)
  return Boolean(expectedSecret && providedSecret && providedSecret === expectedSecret)
}

async function executeDailyReset() {
  const result = await runDailyScheduler()

  return NextResponse.json({
    ...result,
    telegram_reports: result.reports?.map((report) => ({
      client: report.client.name,
      delivered: report.delivery?.delivered,
    })),
  })
}

export async function POST(request: NextRequest) {
  try {
    if (!authorizeCron(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return executeDailyReset()
  } catch (error) {
    console.error('[API] Failed to run daily reset', error)
    return NextResponse.json({ error: 'Failed to run daily reset' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  if (hasCredential(request)) {
    try {
      if (!authorizeCron(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      return executeDailyReset()
    } catch (error) {
      console.error('[API] Failed to run daily reset', error)
      return NextResponse.json({ error: 'Failed to run daily reset' }, { status: 500 })
    }
  }

  return NextResponse.json({
    ok: true,
    endpoint: 'daily-reset',
    auth: 'Pass ?secret=YOUR_CRON_SECRET or Authorization: Bearer YOUR_CRON_SECRET to execute.',
  })
}
