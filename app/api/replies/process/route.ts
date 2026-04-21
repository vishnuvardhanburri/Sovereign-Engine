import { NextResponse } from 'next/server'
import { processReplyPayload } from '@/lib/agents/inbox/reply-agent'

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const { result } = await processReplyPayload(body)
  return NextResponse.json(result)
}
