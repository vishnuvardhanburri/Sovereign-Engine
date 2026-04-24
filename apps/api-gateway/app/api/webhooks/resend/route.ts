import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { handleResendWebhook } from '@/lib/backend'
import { appEnv } from '@/lib/env'

export async function POST(request: NextRequest) {
  try {
    const resend = new Resend(appEnv.resendApiKey())
    const payload = await request.text()
    const webhookSecret = appEnv.resendWebhookSecret()

    const verified =
      webhookSecret
        ? resend.webhooks.verify({
            payload,
            headers: {
              id: request.headers.get('svix-id') ?? '',
              timestamp: request.headers.get('svix-timestamp') ?? '',
              signature: request.headers.get('svix-signature') ?? '',
            },
            webhookSecret,
          })
        : JSON.parse(payload)

    const externalId = request.headers.get('svix-id') ?? crypto.randomUUID()
    const result = await handleResendWebhook(
      verified as Record<string, unknown>,
      externalId
    )

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error('[API] Failed to process Resend webhook', error)
    return NextResponse.json({ error: 'Invalid webhook' }, { status: 400 })
  }
}
