import { emitEvent } from '@/lib/events'
import { readSystemMetrics } from '@/lib/metrics'
import { query } from '@/lib/db'
import { getDomainHealth } from '@/lib/delivery/intelligence'
import { shouldPauseWarmup, getWarmupDailyCap } from '@/lib/warmup'
import { applyCampaignStrategy, evaluateCampaignStrategy } from '@/lib/campaign/strategy'

export interface ControlLoopDecision {
  send_rate_multiplier: number
  domain_actions: Array<{ domain_id: number; action: 'scale' | 'stable' | 'throttle' | 'pause'; health_score: number }>
  reason: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export async function runControlLoop(clientId: number): Promise<ControlLoopDecision> {
  const metrics = await readSystemMetrics(clientId, 60)

  // Campaign strategy adjustments (deterministic).
  const campaigns = await query<{ id: number }>(
    `SELECT id FROM campaigns WHERE client_id = $1 AND status = 'active'`,
    [clientId]
  )
  for (const c of campaigns.rows) {
    const decision = await evaluateCampaignStrategy(clientId, c.id)
    if (decision.action !== 'keep') {
      await applyCampaignStrategy(clientId, decision)
    }
  }

  const domains = await query<{ id: number }>(
    `SELECT id FROM domains WHERE client_id = $1`,
    [clientId]
  )

  const domainActions: ControlLoopDecision['domain_actions'] = []

  for (const d of domains.rows) {
    const dailyCap = await getWarmupDailyCap(clientId, d.id)
    const pauseWarmup = await shouldPauseWarmup(clientId, d.id)

    const recent = await query<{ bounce_rate: number; reply_rate: number }>(
      `
      SELECT
        COALESCE((COUNT(*) FILTER (WHERE event_type = 'bounce'))::float / NULLIF(COUNT(*) FILTER (WHERE event_type = 'sent'), 0), 0) AS bounce_rate,
        COALESCE((COUNT(*) FILTER (WHERE event_type = 'reply'))::float / NULLIF(COUNT(*) FILTER (WHERE event_type = 'sent'), 0), 0) AS reply_rate
      FROM events
      WHERE client_id = $1 AND domain_id = $2 AND created_at > NOW() - INTERVAL '24 hours'
      `,
      [clientId, d.id]
    )

    const row = recent.rows[0]
    const health = getDomainHealth({
      bounce_rate: Number(row?.bounce_rate ?? 0) || 0,
      reply_rate: Number(row?.reply_rate ?? 0) || 0,
      spam_signals: 0,
    })

    const action = pauseWarmup ? 'pause' : health.mode
    domainActions.push({ domain_id: d.id, action, health_score: health.score })

    // Persist a safe cap hint for operator dashboards / future decisions.
    await query(
      `UPDATE domains
       SET daily_cap = $3, updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1 AND id = $2`,
      [clientId, d.id, dailyCap]
    )
  }

  // Send-rate decision is conservative: protect deliverability first.
  const sendRateMultiplier =
    metrics.bounce_rate > 0.05 ? 0.4 :
    metrics.bounce_rate > 0.03 ? 0.7 :
    metrics.reply_rate > 0.02 ? 1.1 :
    1.0

  const decision: ControlLoopDecision = {
    send_rate_multiplier: clamp(sendRateMultiplier, 0, 1.25),
    domain_actions: domainActions,
    reason: `metrics: reply=${metrics.reply_rate.toFixed(3)} open=${metrics.open_rate.toFixed(3)} bounce=${metrics.bounce_rate.toFixed(3)} queue=${metrics.queue_depth}`,
  }

  await emitEvent({
    event_type: 'DECISION_MADE',
    source_agent: 'control_loop',
    payload: { ...decision, timestamp: new Date().toISOString() } as unknown as Record<string, unknown>,
  })

  return decision
}
