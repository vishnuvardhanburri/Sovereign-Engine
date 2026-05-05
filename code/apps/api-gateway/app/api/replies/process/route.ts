import { NextResponse } from 'next/server'
import { processReplyPayload } from '@/lib/agents/inbox/reply-agent'
import { cancelContactQueue } from '@/lib/queue-control'
import { emitEvent } from '@/lib/events'

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const { result, events } = await processReplyPayload(body)

  if (result.contact_email && result.action === 'STOP_SEQUENCE') {
    await cancelContactQueue(result.contact_email)
  }

  for (const event of events) {
    await emitEvent(event)
  }

  return NextResponse.json(result)
}
