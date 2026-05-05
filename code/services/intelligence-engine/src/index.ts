import type { DbExecutor } from '@sovereign/types'
import { detectProvider, type Provider } from '@sovereign/provider-engine'

export interface IntelligenceDeps {
  db: DbExecutor
}

export interface GlobalIntelligence {
  clientId: number
  generatedAt: string
  global_domain_score: number // 0..1 aggregate health
  provider_risk: Record<Provider, number> // 0..1 higher = riskier
  time_of_day_performance: Array<{ hour: number; reply_rate: number; bounce_rate: number }>
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

export async function computeGlobalIntelligence(deps: IntelligenceDeps, clientId: number): Promise<GlobalIntelligence> {
  // Global domain score: weighted by sent_count.
  const domains = await deps.db<{ sent_count: string; health_score: string }>(
    `SELECT COALESCE(sent_count,0)::text AS sent_count,
            COALESCE(health_score,100)::text AS health_score
     FROM domains
     WHERE client_id = $1`,
    [clientId]
  )
  const weighted = domains.rows.reduce(
    (acc, d) => {
      const sent = Number(d.sent_count ?? 0)
      const health = Number(d.health_score ?? 100) / 100
      acc.sent += sent
      acc.sum += sent * health
      return acc
    },
    { sent: 0, sum: 0 }
  )
  const global_domain_score = weighted.sent > 0 ? clamp(weighted.sum / weighted.sent, 0, 1) : 1

  // Provider risk: bounce+fail ratio over last 7 days grouped by provider.
  const events = await deps.db<{ to_email: string | null; event_type: string }>(
    `SELECT
       (metadata->>'to')::text AS to_email,
       event_type
     FROM events
     WHERE client_id = $1
       AND created_at > NOW() - INTERVAL '7 days'
       AND event_type IN ('sent','failed','bounce','reply')`,
    [clientId]
  )

  const providerAgg: Record<Provider, { sent: number; bad: number }> = {
    gmail: { sent: 0, bad: 0 },
    outlook: { sent: 0, bad: 0 },
    yahoo: { sent: 0, bad: 0 },
    other: { sent: 0, bad: 0 },
  }

  for (const e of events.rows) {
    const provider = detectProvider(e.to_email ?? '')
    if (e.event_type === 'sent') providerAgg[provider].sent += 1
    if (e.event_type === 'bounce' || e.event_type === 'failed') providerAgg[provider].bad += 1
  }

  const provider_risk = Object.fromEntries(
    (Object.keys(providerAgg) as Provider[]).map((p) => {
      const { sent, bad } = providerAgg[p]
      const risk = sent > 0 ? clamp(bad / sent, 0, 1) : 0
      return [p, risk]
    })
  ) as Record<Provider, number>

  // Time-of-day performance: based on events by hour for last 14 days.
  const tod = await deps.db<{ hour: number; sent: string; replies: string; bounces: string }>(
    `SELECT
       EXTRACT(HOUR FROM created_at)::int AS hour,
       COUNT(CASE WHEN event_type='sent' THEN 1 END)::text AS sent,
       COUNT(CASE WHEN event_type='reply' THEN 1 END)::text AS replies,
       COUNT(CASE WHEN event_type='bounce' THEN 1 END)::text AS bounces
     FROM events
     WHERE client_id = $1
       AND created_at > NOW() - INTERVAL '14 days'
       AND event_type IN ('sent','reply','bounce')
     GROUP BY 1
     ORDER BY 1`,
    [clientId]
  )

  const time_of_day_performance = tod.rows.map((r) => {
    const sent = Number(r.sent ?? 0)
    const replies = Number(r.replies ?? 0)
    const bounces = Number(r.bounces ?? 0)
    return {
      hour: Number(r.hour),
      reply_rate: sent > 0 ? clamp(replies / sent, 0, 1) : 0,
      bounce_rate: sent > 0 ? clamp(bounces / sent, 0, 1) : 0,
    }
  })

  return {
    clientId,
    generatedAt: new Date().toISOString(),
    global_domain_score,
    provider_risk,
    time_of_day_performance,
  }
}

