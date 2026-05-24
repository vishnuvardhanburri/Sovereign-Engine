import { NextRequest } from 'next/server'
import { appEnv } from '@/lib/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authorized(request: NextRequest): boolean {
  const expected = appEnv.cronSecret()
  const provided =
    request.headers.get('x-cron-secret') ||
    request.nextUrl.searchParams.get('secret') ||
    ''
  return Boolean(expected && provided && provided === expected)
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return new Response('ok=0 error=unauthorized', {
      status: 401,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  }

  return new Response(`ok=1 pong=1 ts=${new Date().toISOString()}`, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
