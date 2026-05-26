import os from 'node:os'
import { query } from '@/lib/db'
import { getAutonomousQueueCounts } from '@/lib/queue/autonomous-queue-client'
import { appendOperationalEvent, recordTelemetrySnapshot } from '@/lib/operational-events'
import { tripCircuitBreaker } from '@/lib/observability/circuit-breaker'

export async function recordWorkerHeartbeat(input: {
  clientId?: number
  workerName: string
  queueName?: string
  status?: 'starting' | 'healthy' | 'degraded' | 'stopped'
  metrics?: Record<string, unknown>
}) {
  await query(
    `INSERT INTO worker_heartbeats (
       worker_name,
       instance_id,
       client_id,
       queue_name,
       status,
       metrics,
       last_seen_at
     )
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,now())
     ON CONFLICT (worker_name, instance_id, queue_name) DO UPDATE
     SET client_id = EXCLUDED.client_id,
         status = EXCLUDED.status,
         metrics = EXCLUDED.metrics,
         last_seen_at = now()`,
    [
      input.workerName,
      process.env.RENDER_INSTANCE_ID || process.env.HOSTNAME || os.hostname(),
      input.clientId ?? null,
      input.queueName ?? 'control',
      input.status ?? 'healthy',
      JSON.stringify(input.metrics ?? {}),
    ]
  )
}

export async function collectOperationalTelemetry(clientId: number) {
  const [queueCounts, providerRows, sourceRows, eventRows, workerRows] = await Promise.all([
    getAutonomousQueueCounts(),
    query<{
      provider: string
      lane: string
      status: string
      emergency_brake_active: boolean
      bounce_rate_24h: string
      failure_rate_24h: string
      reply_rate_7d: string
    }>(
      `SELECT provider,
              lane,
              status,
              emergency_brake_active,
              bounce_rate_24h::text,
              failure_rate_24h::text,
              reply_rate_7d::text
       FROM provider_lanes
       WHERE client_id = $1
       ORDER BY provider, lane`,
      [clientId]
    ),
    query<{ source_type: string; status: string; count: string }>(
      `SELECT source_type, status, COUNT(*)::text
       FROM source_connections
       WHERE client_id = $1
       GROUP BY source_type, status`,
      [clientId]
    ),
    query<{ event_type: string; count: string }>(
      `SELECT event_type, COUNT(*)::text
       FROM events
       WHERE client_id = $1
         AND created_at > now() - INTERVAL '24 hours'
       GROUP BY event_type`,
      [clientId]
    ),
    query<{ worker_name: string; queue_name: string; status: string; last_seen_at: string }>(
      `SELECT worker_name, queue_name, status, last_seen_at::text
       FROM worker_heartbeats
       WHERE last_seen_at > now() - INTERVAL '10 minutes'
       ORDER BY last_seen_at DESC
       LIMIT 50`
    ),
  ])

  const metrics = {
    queues: queueCounts,
    providers: providerRows.rows,
    sources: sourceRows.rows,
    events24h: Object.fromEntries(eventRows.rows.map((row) => [row.event_type, Number(row.count)])),
    workers: workerRows.rows,
    sampledAt: new Date().toISOString(),
  }

  await recordTelemetrySnapshot({
    clientId,
    snapshotType: 'autonomous_ops',
    metrics,
  })

  const totalFailed = Number((metrics.events24h as Record<string, number>).failed ?? 0)
  const totalBounced = Number((metrics.events24h as Record<string, number>).bounce ?? 0)
  const totalSent = Number((metrics.events24h as Record<string, number>).sent ?? 0)
  const failurePressure = totalSent > 0 ? (totalFailed + totalBounced) / Math.max(totalSent, 1) : 0
  if (failurePressure >= 0.25 && totalSent >= 10) {
    await tripCircuitBreaker({
      clientId,
      scope: 'outbound:sending',
      reason: 'high_24h_failure_pressure',
      ttlSeconds: 60 * 60,
      metadata: { totalSent, totalFailed, totalBounced },
    })
  }

  await appendOperationalEvent({
    clientId,
    eventType: 'telemetry.sampled',
    aggregateType: 'command_center',
    aggregateId: 'autonomous_ops',
    actorType: 'worker',
    payload: {
      queueWaiting: Object.values(queueCounts).reduce((sum, value) => sum + value.waiting, 0),
      totalSent,
      totalFailed,
      totalBounced,
    },
  })

  return metrics
}
