import { emitEvent } from '@/lib/events'
import { runSystemHealthCheck, autoHeal } from '@/lib/infrastructure/self-healing'
import { restartQueueIfStuck } from '@/lib/queue-control'
import { query } from '@/lib/db'

export interface RecoveryActionResult {
  recovered: boolean
  actions: string[]
}

export async function runSelfHealing(clientId: number): Promise<RecoveryActionResult> {
  const actions: string[] = []
  const health = await runSystemHealthCheck()

  if (!health.isHealthy) {
    const healed = await autoHeal()
    for (const action of healed) {
      actions.push(`${action.type}:${action.success ? 'ok' : 'fail'}`)
    }
  }

  // Queue stuck heuristic: if there are pending jobs but nothing is being processed.
  const queue = await query<{ pending: string; processing: string }>(
    `
    SELECT
      COUNT(*) FILTER (WHERE status IN ('pending','retry'))::text AS pending,
      COUNT(*) FILTER (WHERE status = 'processing')::text AS processing
    FROM queue_jobs
    WHERE client_id = $1
      AND scheduled_at <= CURRENT_TIMESTAMP
    `,
    [clientId]
  )
  const pending = Number(queue.rows[0]?.pending ?? 0) || 0
  const processing = Number(queue.rows[0]?.processing ?? 0) || 0
  if (pending > 0 && processing === 0) {
    await restartQueueIfStuck()
    actions.push('queue_restart')
  }

  const recovered = actions.length > 0
  await emitEvent({
    event_type: 'RECOVERY_ACTION',
    source_agent: 'self_healing',
    payload: { recovered, actions, healthy: health.isHealthy, issues: health.issues, timestamp: new Date().toISOString() },
  })

  return { recovered, actions }
}
