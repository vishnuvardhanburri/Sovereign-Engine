import { NextRequest, NextResponse } from 'next/server'
import { appEnv } from '@/lib/env'
import { notifyTelegramEvent } from '@/lib/telegram-notifications'
import { getOutboundTelegramDigest } from '@/lib/outbound-telegram-digest'

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
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const clientId = Number(
    request.nextUrl.searchParams.get('client_id') ||
      process.env.DEFAULT_CLIENT_ID ||
      1
  )

  const digest = await getOutboundTelegramDigest(clientId)

  const delivery = await notifyTelegramEvent({
    type: 'daily_outbound',
    dryRun: false,
    queued: digest.queuedNow,
    ...digest,
  })

  return NextResponse.json({
    ok: true,
    digest,
    telegram: delivery,
    configured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
  })
}
