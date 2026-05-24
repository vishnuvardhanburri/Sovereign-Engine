import { NextRequest } from 'next/server'
import { appEnv } from '@/lib/env'
import { enqueueOutboundCycleJob } from '@/lib/outbound-cycle-queue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authorize(request: NextRequest): boolean {
  const expected = appEnv.cronSecret()
  const provided =
    request.headers.get('x-cron-secret') ||
    request.nextUrl.searchParams.get('secret') ||
    ''
  return Boolean(expected && provided && provided === expected)
}

function safeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function clientIdFrom(request: NextRequest): number {
  const parsed = Number(request.nextUrl.searchParams.get('client_id') || process.env.DEFAULT_CLIENT_ID || 1)
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 1
}

function buildRunUrl(request: NextRequest, clientId: number): string {
  const runUrl = new URL('/api/cron/daily-outbound', request.nextUrl.origin)
  const params = request.nextUrl.searchParams

  for (const key of [
    'mode',
    'recoveryMode',
    'targetDailyVolume',
    'sendLimit',
    'approveLimit',
    'providerValidationLimit',
    'mapsLimit',
    'mapsPlacesPerSearch',
  ]) {
    const value = params.get(key)
    if (value) runUrl.searchParams.set(key, value)
  }

  runUrl.searchParams.set('client_id', String(clientId))
  runUrl.searchParams.set('compact', '1')
  runUrl.searchParams.set('cronCompact', '1')

  return runUrl.toString()
}

export async function POST(request: NextRequest) {
  return GET(request)
}

export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return new Response('ok=0 error=unauthorized', {
      status: 401,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  }

  try {
    const clientId = clientIdFrom(request)
    const queued = await enqueueOutboundCycleJob({
      clientId,
      runUrl: buildRunUrl(request, clientId),
    })

    return new Response(
      [
        'ok=1',
        'cycleQueued=1',
        `client=${clientId}`,
        `queue=${queued.queue}`,
        `job=${queued.jobId ?? queued.dedupeKey}`,
        'worker=embedded',
        `ts=${new Date().toISOString()}`,
      ].join(' '),
      {
        status: 202,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
        },
      }
    )
  } catch (error) {
    console.error('[api/cron/daily-outbound-kick] enqueue failed', error)
    return new Response(`ok=0 cycleQueued=0 error=${safeError(error).slice(0, 240)}`, {
      status: 500,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  }
}
