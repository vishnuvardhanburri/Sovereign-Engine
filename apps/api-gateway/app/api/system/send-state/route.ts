import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { resolveClientId } from '@/lib/client-context'
import IORedis from 'ioredis'
import { Queue } from 'bullmq'

function reqEnv(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

const REGION = process.env.XV_REGION ?? 'local'
const redis = new IORedis(reqEnv('REDIS_URL'))

export async function GET(request: NextRequest) {
  try {
    const clientId = await resolveClientId({ headers: request.headers })

    const legacyReady = process.env.LEGACY_READY_QUEUE ?? 'email:queue'
    const legacyScheduled = process.env.LEGACY_SCHEDULED_QUEUE ?? 'email:queue:scheduled'
    const legacyProcessing = process.env.LEGACY_PROCESSING_QUEUE ?? 'email:queue:processing'
    const legacyVisibility = process.env.LEGACY_VISIBILITY_ZSET ?? 'email:queue:visibility'

    const sendQueueName = process.env.SEND_QUEUE ?? 'xv-send-queue'
    const bull = new Queue(sendQueueName, { connection: { url: reqEnv('REDIS_URL') } })

    const [dueJobs, lastAttempt, legacyCounts, bullCounts] = await Promise.all([
      query<{ due: string }>(
        `SELECT COUNT(*)::text AS due
         FROM queue_jobs
         WHERE client_id = $1 AND status IN ('pending','retry')
           AND scheduled_at <= CURRENT_TIMESTAMP`,
        [clientId]
      ),
      query<{ ts: string | null }>(
        `SELECT MAX(created_at)::text AS ts
         FROM events
         WHERE client_id = $1
           AND event_type IN ('sent','failed','bounce','retry')`,
        [clientId]
      ),
      Promise.all([
        redis.llen(legacyReady),
        redis.zcard(legacyScheduled),
        redis.llen(legacyProcessing),
        redis.zcard(legacyVisibility),
      ]),
      bull.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed'),
    ])

    const lastAttemptTs = String(lastAttempt.rows[0]?.ts ?? '')
    const lastAttemptMs = lastAttemptTs ? Date.parse(lastAttemptTs) : null

    const [ready, scheduled, processing, visibility] = legacyCounts.map((n) => Number(n ?? 0))

    const deployConservative = await redis.get(`xv:${REGION}:deploy:conservative`)
    const pressureSlow = await redis.get(`xv:${REGION}:adaptive:pressure_slow:${clientId}`)

    await bull.close()

    return NextResponse.json({
      ok: true,
      clientId,
      due_jobs: Number(dueJobs.rows[0]?.due ?? 0),
      last_send_attempt: {
        ts: lastAttemptTs || null,
        age_ms: lastAttemptMs ? Math.max(0, Date.now() - lastAttemptMs) : null,
      },
      legacy_queue: {
        ready,
        scheduled,
        processing,
        visibility,
      },
      bullmq_queue: {
        name: sendQueueName,
        counts: bullCounts,
      },
      safety: {
        deploy_conservative_factor: deployConservative ? Number(deployConservative) : null,
        pressure_slow_factor: pressureSlow ? Number(pressureSlow) : null,
      },
    })
  } catch (error) {
    console.error('[api/system/send-state] failed', error)
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 })
  }
}

