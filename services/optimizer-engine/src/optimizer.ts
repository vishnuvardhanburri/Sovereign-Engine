import type { DbExecutor, Lane } from '@xavira/types'
import type { Redis } from 'ioredis'
import { analyze, type OptimizerMetrics } from './analyzer'
import { adjust, type PolicyAction } from './policy-adjuster'
import { OptimizerMemory } from './memory'

export type OptimizerMode = 'observe' | 'apply'

export interface OptimizerDeps {
  db: DbExecutor
  redis: Redis
  mode: OptimizerMode
}

export interface DomainOptimizerState {
  domainId: number
  domain: string
  metrics: OptimizerMetrics
  analysis: ReturnType<typeof analyze>
  recommended: PolicyAction
  applied?: { action: PolicyAction; at: string } | null
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function laneForAction(action: PolicyAction): Lane | null {
  if (action.action === 'shift_lane') return action.to
  if (action.action === 'reduce_volume') return 'slow'
  return null
}

export async function computeDomainMetrics(db: DbExecutor, clientId: number, domainId: number): Promise<OptimizerMetrics | null> {
  const domainRes = await db<{
    id: number
    domain: string
    bounce_rate: string | number
    health_score: string | number
  }>(
    `SELECT id, domain, bounce_rate, health_score
     FROM domains
     WHERE client_id = $1 AND id = $2
     LIMIT 1`,
    [clientId, domainId]
  )
  const domain = domainRes.rows[0]
  if (!domain) return null

  const bounceRate = Number(domain.bounce_rate ?? 0) / 100 // stored as percentage in DB

  const replyRes = await db<{ sent: string; replies: string; failed: string }>(
    `SELECT
       COUNT(CASE WHEN event_type = 'sent' THEN 1 END)::text AS sent,
       COUNT(CASE WHEN event_type = 'reply' THEN 1 END)::text AS replies,
       COUNT(CASE WHEN event_type = 'failed' THEN 1 END)::text AS failed
     FROM events
     WHERE client_id = $1
       AND domain_id = $2
       AND created_at > NOW() - INTERVAL '7 days'`,
    [clientId, domainId]
  )
  const sent = Number(replyRes.rows[0]?.sent ?? 0)
  const replies = Number(replyRes.rows[0]?.replies ?? 0)
  const failed = Number(replyRes.rows[0]?.failed ?? 0)

  const replyRate = sent > 0 ? replies / sent : 0
  const sendSuccessRate = sent + failed > 0 ? sent / (sent + failed) : 1

  return {
    bounce_rate: clamp(bounceRate, 0, 1),
    reply_rate: clamp(replyRate, 0, 1),
    send_success_rate: clamp(sendSuccessRate, 0, 1),
    domain_health: clamp(Number(domain.health_score ?? 0) / 100, 0, 1),
  }
}

async function applyAdjustment(db: DbExecutor, clientId: number, domainId: number, action: PolicyAction): Promise<void> {
  if (action.action === 'reduce_volume' || action.action === 'increase_volume') {
    const row = await db<{ daily_limit: number }>(
      `SELECT daily_limit
       FROM domains
       WHERE client_id = $1 AND id = $2`,
      [clientId, domainId]
    )
    const current = Number(row.rows[0]?.daily_limit ?? 0)
    if (current <= 0) return
    const factor = action.factor
    const next = Math.round(clamp(current * factor, 20, 50_000))
    await db(
      `UPDATE domains
       SET daily_limit = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1 AND id = $2`,
      [clientId, domainId, next]
    )
    return
  }

  if (action.action === 'pause_domain') {
    await db(
      `UPDATE domains
       SET status = 'paused',
           updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1 AND id = $2`,
      [clientId, domainId]
    )
  }
}

export async function runOptimizerOnce(deps: OptimizerDeps, clientId: number): Promise<{ domains: DomainOptimizerState[] }> {
  const memory = new OptimizerMemory(deps.redis)
  const domainsRes = await deps.db<{ id: number; domain: string; status: string }>(
    `SELECT id, domain, status
     FROM domains
     WHERE client_id = $1`,
    [clientId]
  )

  const results: DomainOptimizerState[] = []
  for (const d of domainsRes.rows) {
    const metrics = await computeDomainMetrics(deps.db, clientId, d.id)
    if (!metrics) continue
    const analysis = analyze(metrics)
    const recommended = adjust(analysis)

    // fail-safe: never increase if bounce is above threshold
    if (metrics.bounce_rate > 0.08 && recommended.action === 'increase_volume') {
      results.push({
        domainId: d.id,
        domain: d.domain,
        metrics,
        analysis,
        recommended: { action: 'no_change' },
        applied: null,
      })
      continue
    }

    const mem = await memory.updateDomain(d.id, { bounceRate: metrics.bounce_rate, replyRate: metrics.reply_rate })

    let applied: DomainOptimizerState['applied'] = null
    if (deps.mode === 'apply') {
      // Guard: do not apply repeatedly within 10 minutes.
      const lastAt = mem.lastActionAt ?? 0
      if (Date.now() - lastAt > 10 * 60_000) {
        // Domain risk can escalate to pause.
        const actionToApply: PolicyAction =
          analysis.domainRisk && metrics.bounce_rate > 0.12 ? { action: 'pause_domain' } : recommended
        if (actionToApply.action !== 'no_change') {
          await applyAdjustment(deps.db, clientId, d.id, actionToApply)
          await memory.updateDomain(d.id, {
            lastAction: actionToApply.action,
            lastActionAt: Date.now(),
          })
          applied = { action: actionToApply, at: new Date().toISOString() }
        }
      }
    }

    results.push({
      domainId: d.id,
      domain: d.domain,
      metrics,
      analysis,
      recommended,
      applied,
    })
  }

  return { domains: results }
}

