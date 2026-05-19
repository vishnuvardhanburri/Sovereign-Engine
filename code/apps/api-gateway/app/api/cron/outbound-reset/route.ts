import { NextRequest, NextResponse } from 'next/server'
import { appEnv } from '@/lib/env'
import { buildOutboundResetPreview, runOutboundReset } from '@/lib/outbound-reset'

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

function boolParam(value: string | null): boolean {
  return ['1', 'true', 'yes', 'y'].includes(String(value ?? '').trim().toLowerCase())
}

async function execute(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const clientId = Number(params.get('client_id') || process.env.DEFAULT_CLIENT_ID || 1)
  const apply = boolParam(params.get('apply'))
  const dryRun = params.has('dryRun') ? boolParam(params.get('dryRun')) : !apply
  const queueScanLimit = Number(params.get('queueScanLimit') || 5000)

  const result = await runOutboundReset({
    clientId,
    dryRun,
    apply,
    queueScanLimit,
  })

  return NextResponse.json(result)
}

export async function POST(request: NextRequest) {
  try {
    if (!authorizeCron(request)) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    }

    return execute(request)
  } catch (error) {
    console.error('[cron/outbound-reset] failed', error)
    return NextResponse.json({ ok: false, error: 'Failed to reset outbound data' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  if (hasCredential(request)) {
    try {
      if (!authorizeCron(request)) {
        return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
      }

      return execute(request)
    } catch (error) {
      console.error('[cron/outbound-reset] failed', error)
      return NextResponse.json({ ok: false, error: 'Failed to reset outbound data' }, { status: 500 })
    }
  }

  return NextResponse.json({
    ...buildOutboundResetPreview({ clientId: 1, dryRun: true, apply: false }),
    endpoint: 'outbound-reset',
    auth: 'Pass ?secret=YOUR_CRON_SECRET to preview. Add &apply=1 to actually clear scoped outbound data.',
  })
}
