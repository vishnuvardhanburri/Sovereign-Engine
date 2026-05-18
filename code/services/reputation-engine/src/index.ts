import type { DbExecutor, TrackingIngestEvent } from '@sovereign/types'

export interface ReputationDeps {
  db: DbExecutor
}

export interface DomainScore {
  domainId: number
  score: number // 0..1
  healthScore: number // 0..100
  bounceRate: number // percentage
}

export interface DomainHealthPolicyInput {
  sentCount: number
  bounceCount: number
  currentStatus?: string
}

export interface DomainHealthPolicy {
  rawBounceRate: number
  effectiveBounceRate: number
  healthScore: number
  shouldPause: boolean
  nextStatus: string
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function roundPct(n: number) {
  return Number(n.toFixed(2))
}

export function calculateDomainHealthPolicy(input: DomainHealthPolicyInput): DomainHealthPolicy {
  const sentCount = Math.max(0, Number(input.sentCount) || 0)
  const bounceCount = Math.max(0, Number(input.bounceCount) || 0)
  const currentStatus = input.currentStatus || 'active'

  const rawBounceRate = sentCount > 0 ? roundPct((bounceCount / sentCount) * 100) : 0

  // Small samples are noisy. A single bad address must slow the lane, not brick the domain.
  const smoothingSends = 25
  const effectiveBounceRate = sentCount > 0 ? roundPct((bounceCount / (sentCount + smoothingSends)) * 100) : 0
  const healthScore = clamp(Math.round(100 - effectiveBounceRate * 8), 0, 100)

  const enoughEvidenceToPause = sentCount >= 20 || bounceCount >= 3
  const shouldPause = enoughEvidenceToPause && rawBounceRate > 5
  const nextStatus = shouldPause ? 'paused' : currentStatus === 'paused' && rawBounceRate <= 5 ? 'active' : currentStatus

  return {
    rawBounceRate,
    effectiveBounceRate,
    healthScore,
    shouldPause,
    nextStatus,
  }
}

export async function getDomainScore(deps: ReputationDeps, clientId: number, domainId: number): Promise<DomainScore | null> {
  const res = await deps.db<{
    id: number
    health_score: string | number
    bounce_rate: string | number
  }>(
    `SELECT id, health_score, bounce_rate
     FROM domains
     WHERE client_id = $1 AND id = $2
     LIMIT 1`,
    [clientId, domainId]
  )
  const row = res.rows[0]
  if (!row) return null
  const healthScore = Number(row.health_score ?? 0)
  const bounceRate = Number(row.bounce_rate ?? 0)
  // Map 0..100 health to 0..1 score and penalize bounce rate.
  const score = Math.max(0, Math.min(1, (healthScore / 100) * Math.max(0, 1 - bounceRate / 10)))
  return { domainId: row.id, score, healthScore, bounceRate }
}

export async function shouldPauseDomain(deps: ReputationDeps, clientId: number, domainId: number): Promise<boolean> {
  const res = await deps.db<{
    spf_valid: boolean
    dkim_valid: boolean
    dmarc_valid: boolean
    bounce_rate: string | number
    health_score: string | number
  }>(
    `SELECT spf_valid, dkim_valid, dmarc_valid, bounce_rate, health_score
     FROM domains
     WHERE client_id = $1 AND id = $2
     LIMIT 1`,
    [clientId, domainId]
  )
  const row = res.rows[0]
  if (!row) return false
  const bounceRate = Number(row.bounce_rate ?? 0)
  const healthScore = Number(row.health_score ?? 0)
  if (bounceRate > 12) return true
  if (bounceRate > 5 && healthScore < 30) return true
  return false
}

export async function updateDomainStats(deps: ReputationDeps, event: TrackingIngestEvent): Promise<void> {
  if (!event.domainId) return

  // Update counters and bounce metrics. We intentionally do not change schema.
  if (event.type === 'BOUNCED') {
    await deps.db(
      `UPDATE domains
       SET bounce_count = bounce_count + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1 AND id = $2`,
      [event.clientId, event.domainId]
    )
  }

  // Recompute bounce_rate + health_score using the same logic as the legacy risk-agent.
  const rowRes = await deps.db<{
    sent_count: string | number
    bounce_count: string | number
    status: string
  }>(
    `SELECT sent_count, bounce_count, status
     FROM domains
     WHERE client_id = $1 AND id = $2
     LIMIT 1`,
    [event.clientId, event.domainId]
  )
  const row = rowRes.rows[0]
  if (!row) return

  const policy = calculateDomainHealthPolicy({
    sentCount: Number(row.sent_count ?? 0),
    bounceCount: Number(row.bounce_count ?? 0),
    currentStatus: row.status,
  })

  await deps.db(
    `UPDATE domains
     SET bounce_rate = $3,
         health_score = $4,
         status = $5,
         updated_at = CURRENT_TIMESTAMP
     WHERE client_id = $1 AND id = $2`,
    [event.clientId, event.domainId, policy.rawBounceRate, policy.healthScore, policy.nextStatus]
  )
}
