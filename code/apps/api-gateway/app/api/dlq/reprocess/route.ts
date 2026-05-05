import { NextRequest, NextResponse } from 'next/server'
import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import { query } from '@/lib/db'
import { resolveClientId } from '@/lib/client-context'

function reqEnv(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

const REGION = process.env.XV_REGION ?? 'local'
const sendQueueName = process.env.SEND_QUEUE ?? 'xv-send-queue'
const dlqName = process.env.SEND_DLQ ?? 'xv-send-dlq'

let redis: IORedis | null = null
let sendQueue: Queue | null = null
let dlq: Queue | null = null

function getRedis() {
  if (!redis) redis = new IORedis(reqEnv('REDIS_URL'), { maxRetriesPerRequest: 2 })
  return redis
}

function getQueues() {
  const connection = { url: reqEnv('REDIS_URL') }
  if (!sendQueue) sendQueue = new Queue(sendQueueName, { connection })
  if (!dlq) dlq = new Queue(dlqName, { connection })
  return { sendQueue, dlq } as { sendQueue: Queue; dlq: Queue }
}

export async function POST(request: NextRequest) {
  try {
    const clientId = await resolveClientId({ headers: request.headers })
    const body = (await request.json().catch(() => ({}))) as { limit?: number }
    const limit = Math.max(1, Math.min(200, Number(body.limit ?? 50)))

    // Safety gates (best-effort):
    // - do not reprocess if global risk/cooldown is active
    const redis = getRedis()
    const { sendQueue, dlq } = getQueues()
    const globalRisk = await redis.get(`xv:${REGION}:adaptive:global_risk:${clientId}`)
    if (globalRisk) {
      return NextResponse.json({ ok: false, error: 'provider_or_global_cooldown_active' }, { status: 409 })
    }

    const jobs = await dlq.getJobs(['waiting', 'delayed'], 0, limit - 1, true)
    let moved = 0
    const results: any[] = []

    for (const j of jobs) {
      const payload: any = j.data
      if (!payload || payload.clientId !== clientId) continue

      // Gate by domain health if domainId exists in payload metadata (optional).
      // If missing, allow reprocess but keep conservative (worker will still gate).
      const domainId = payload.domainId ?? payload?.selection?.domainId ?? null
      if (domainId) {
        const dom = await query<{ health_score: string; status: string }>(
          `SELECT health_score::text AS health_score, status
           FROM domains
           WHERE client_id = $1 AND id = $2
           LIMIT 1`,
          [clientId, Number(domainId)]
        )
        const row = dom.rows[0]
        const health = Number(row?.health_score ?? 0)
        if (!row || row.status !== 'active' || health < 60) {
          results.push({ dlqJobId: j.id, action: 'skip', reason: 'domain_unhealthy_or_paused' })
          continue
        }
      }

      await sendQueue.add(
        'send',
        { ...payload, retry_reason: 'dlq_reprocess' },
        { removeOnComplete: true, removeOnFail: 10_000 }
      )
      await j.remove()
      moved++
      results.push({ dlqJobId: j.id, action: 'requeued' })
    }

    return NextResponse.json({ ok: true, clientId, moved, results })
  } catch (err) {
    console.error('[api/dlq/reprocess] failed', err)
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 })
  }
}
