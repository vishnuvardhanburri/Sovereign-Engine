import { query } from '@/lib/db'
import { getQueueLength, promoteDueQueueJobs } from '@/lib/redis'
import { emitEvent } from '@/lib/events'

export interface OptimizerConfig {
  promote_batch: number
  max_queue_depth: number
  min_delay_ms: number
}

const DEFAULTS: OptimizerConfig = {
  promote_batch: 500,
  max_queue_depth: 250000,
  min_delay_ms: 250,
}

export async function runPerformanceOptimizer(clientId: number, config: Partial<OptimizerConfig> = {}) {
  const cfg = { ...DEFAULTS, ...config }

  // Backpressure: if queue is deep, avoid adding more work (API should enqueue only).
  const depth = await getQueueLength()
  if (depth > cfg.max_queue_depth) {
    await emitEvent({
      event_type: 'SYSTEM_ERROR',
      source_agent: 'perf_optimizer',
      payload: { type: 'backpressure', queue_depth: depth },
    })
    return { ok: false, queue_depth: depth, action: 'backpressure' as const }
  }

  // Promote due scheduled items in batches.
  const promoted = await promoteDueQueueJobs(cfg.promote_batch)

  // Domain rate limiting is enforced by decision-agent + identity cool-down.
  // Here we record metrics for the control loop.
  await query(
    `INSERT INTO system_metrics (client_id, metric_name, metric_value, metadata)
     VALUES ($1, 'queue_promoted', $2, $3)`,
    [clientId, promoted, { queue_depth: depth }]
  )

  if (promoted > 0) {
    await new Promise((r) => setTimeout(r, cfg.min_delay_ms))
  }

  return { ok: true, queue_depth: depth, promoted }
}

