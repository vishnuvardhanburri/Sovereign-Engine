import { NextRequest, NextResponse } from 'next/server'
import { appEnv } from '@/lib/env'
import { enqueueAutonomousJob, type AutonomousJobKind } from '@/lib/queue/autonomous-queue-client'

const ALLOWED_KINDS = new Set<AutonomousJobKind>([
  'ingestion.pull',
  'enrichment.score',
  'orchestration.rebalance',
  'conversation.classify',
  'crm.sync',
  'workflow.execute',
  'telemetry.sample',
])

function authorized(request: NextRequest) {
  const secret = appEnv.cronSecret()
  if (!secret) return true
  return request.nextUrl.searchParams.get('secret') === secret || request.headers.get('x-cron-secret') === secret
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return new NextResponse('unauthorized', { status: 401 })
  }
  const clientId = Number(request.nextUrl.searchParams.get('client_id') ?? 1)
  const kind = String(request.nextUrl.searchParams.get('kind') ?? 'telemetry.sample') as AutonomousJobKind
  if (!ALLOWED_KINDS.has(kind)) {
    return new NextResponse('unsupported kind', { status: 400 })
  }
  const sourceConnectionId = request.nextUrl.searchParams.get('sourceConnectionId') ?? undefined
  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 100)
  const job = await enqueueAutonomousJob({
    clientId,
    kind,
    sourceConnectionId,
    limit,
    payload: Object.fromEntries(request.nextUrl.searchParams.entries()),
    requestedBy: 'cron',
  })
  return new NextResponse(`ok=1 kind=${kind} job=${job.id ?? ''} ts=${new Date().toISOString()}`, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const body = await request.json()
  const kind = String(body.kind ?? 'telemetry.sample') as AutonomousJobKind
  if (!ALLOWED_KINDS.has(kind)) {
    return NextResponse.json({ ok: false, error: 'unsupported_kind' }, { status: 400 })
  }
  const job = await enqueueAutonomousJob({
    clientId: Number(body.clientId ?? 1),
    kind,
    sourceConnectionId: body.sourceConnectionId,
    contactId: body.contactId,
    conversationId: body.conversationId,
    workflowId: body.workflowId,
    limit: body.limit,
    payload: body.payload ?? {},
    requestedBy: 'api',
  })
  return NextResponse.json({ ok: true, queued: true, jobId: job.id, kind })
}
