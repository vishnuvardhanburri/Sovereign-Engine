import { NextRequest, NextResponse } from 'next/server'
import { enqueueAutonomousJob } from '@/lib/queue/autonomous-queue-client'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params
  const body = await request.json().catch(() => ({}))
  const clientId = Number(body.clientId ?? request.nextUrl.searchParams.get('client_id') ?? 1)
  const limit = Number(body.limit ?? request.nextUrl.searchParams.get('limit') ?? 100)
  const job = await enqueueAutonomousJob({
    clientId,
    kind: 'ingestion.pull',
    sourceConnectionId: params.id,
    limit,
    requestedBy: 'api',
  })

  return NextResponse.json({ ok: true, queued: true, jobId: job.id, sourceConnectionId: params.id })
}
