import { NextRequest, NextResponse } from 'next/server'
import IORedis from 'ioredis'
import { Queue } from 'bullmq'
import { query } from '@/lib/db'
import { resolveClientId } from '@/lib/client-context'

function reqEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; latencyMs: number }> {
  const started = performance.now()
  const value = await fn()
  return { value, latencyMs: Math.round((performance.now() - started) * 100) / 100 }
}

async function scanSenderHeartbeats(redis: IORedis, region: string) {
  const pattern = `xv:${region}:workers:sender:*`
  let cursor = '0'
  const keys: string[] = []

  do {
    const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
    cursor = nextCursor
    keys.push(...batch)
  } while (cursor !== '0')

  if (!keys.length) return []

  const raw = await redis.mget(...keys)
  return raw
    .map((value, index) => {
      if (!value) return null
      try {
        return { key: keys[index], ...(JSON.parse(value) as Record<string, unknown>) }
      } catch {
        return { key: keys[index], parseError: true }
      }
    })
    .filter(Boolean)
}

export async function GET(request: NextRequest) {
  let redis: IORedis | null = null
  let queue: Queue | null = null

  try {
    const clientId = await resolveClientId({
      searchParams: request.nextUrl.searchParams,
      headers: request.headers,
    })
    const redisUrl = reqEnv('REDIS_URL')
    const queueName = process.env.SEND_QUEUE ?? 'xv-send-queue'
    const region = process.env.XV_REGION ?? 'local'
    redis = new IORedis(redisUrl, { maxRetriesPerRequest: 1 })
    queue = new Queue(queueName, { connection: { url: redisUrl } })

    const redisKey = `xv:health:${clientId}:${Date.now()}`
    const [redisSet, redisGet, dbState, bullCounts, queueRows, workerHeartbeats] = await Promise.all([
      timed(async () => redis!.set(redisKey, '1', 'EX', 30)),
      timed(async () => {
        await redis!.set(redisKey, '1', 'EX', 30)
        return redis!.get(redisKey)
      }),
      timed(async () =>
        query<{ state_count: string; max_updated_at: string | null }>(
          `SELECT COUNT(*)::text AS state_count, MAX(updated_at)::text AS max_updated_at
           FROM reputation_state
           WHERE client_id = $1`,
          [clientId]
        )
      ),
      timed(async () => queue!.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed')),
      timed(async () =>
        query<{ waiting: string; active: string; retry: string; failed: string }>(
          `SELECT
             COUNT(*) FILTER (WHERE status = 'pending')::text AS waiting,
             COUNT(*) FILTER (WHERE status = 'processing')::text AS active,
             COUNT(*) FILTER (WHERE status = 'retry')::text AS retry,
             COUNT(*) FILTER (WHERE status = 'failed')::text AS failed
           FROM queue_jobs
           WHERE client_id = $1`,
          [clientId]
        )
      ),
      timed(async () => scanSenderHeartbeats(redis!, region)),
    ])

    const dbRow = dbState.value.rows[0]
    const queueRow = queueRows.value.rows[0]

    return NextResponse.json({
      ok: true,
      clientId,
      generatedAt: new Date().toISOString(),
      infrastructure_latency: {
        redis_set_ms: redisSet.latencyMs,
        redis_get_ms: redisGet.latencyMs,
        db_reputation_state_ms: dbState.latencyMs,
        bullmq_counts_ms: bullCounts.latencyMs,
        db_queue_counts_ms: queueRows.latencyMs,
        worker_heartbeat_scan_ms: workerHeartbeats.latencyMs,
      },
      redis: {
        set_ok: redisSet.value === 'OK',
        get_ok: redisGet.value === '1',
      },
      postgres: {
        reputation_state_count: Number(dbRow?.state_count ?? 0),
        reputation_state_last_updated_at: dbRow?.max_updated_at ?? null,
      },
      bullmq: {
        queue: queueName,
        waiting: Number((bullCounts.value as any).waiting ?? 0),
        active: Number((bullCounts.value as any).active ?? 0),
        delayed: Number((bullCounts.value as any).delayed ?? 0),
        completed: Number((bullCounts.value as any).completed ?? 0),
        failed: Number((bullCounts.value as any).failed ?? 0),
      },
      db_queue: {
        waiting: Number(queueRow?.waiting ?? 0),
        active: Number(queueRow?.active ?? 0),
        retry: Number(queueRow?.retry ?? 0),
        failed: Number(queueRow?.failed ?? 0),
      },
      workers: {
        sender: {
          active: workerHeartbeats.value.length,
          nodes: workerHeartbeats.value,
        },
      },
    })
  } catch (error) {
    console.error('[api/health/stats] failed', error)
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 })
  } finally {
    await Promise.allSettled([queue?.close(), redis?.quit()])
  }
}
