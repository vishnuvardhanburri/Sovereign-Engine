import { query } from '@/lib/db'
import { appEnv } from '@/lib/env'
import { loadPatternStore, PatternRecord } from '@/lib/ai/pattern-memory'
import { getDemoState, isDemoModeEnabled } from '@/lib/demo-mode'

export type CopilotSystemStatus = 'ACTIVE' | 'DEGRADED' | 'PAUSED' | 'SETUP_REQUIRED'
export type CopilotRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'

export interface CopilotCampaignSnapshot {
  id: number
  name: string
  status: 'draft' | 'active' | 'paused' | 'completed'
  sequenceId: number
  sequenceName: string
  contactCount: number
  sentCount: number
  replyCount: number
  bounceCount: number
  openCount: number
  replyRate: number
  bounceRate: number
  openRate: number
  lastEnqueuedAt: string | null
}

export interface CopilotDomainSnapshot {
  id: number
  domain: string
  status: 'active' | 'paused' | 'warming'
  dailyLimit: number
  dailyCap: number | null
  sentToday: number
  sentCount: number
  bounceCount: number
  bounceRate: number
  spamRate: number
  healthScore: number
  reputationScore: number
  spfValid: boolean
  dkimValid: boolean
  dmarcValid: boolean
  warmupStage: number
  pausedFlag: boolean
  circuitBreakerUntil: string | null
}

export interface CopilotQueueSnapshot {
  pending: number
  processing: number
  retry: number
  failed: number
  completed24h: number
  avgScheduleLagSeconds: number
  oldestPendingSeconds: number
}

export interface CopilotPerformanceSnapshot {
  last24h: {
    sent: number
    replies: number
    bounces: number
    complaints: number
    replyRate: number
    bounceRate: number
  }
  patterns: {
    top: PatternRecord[]
  }
}

export interface CopilotInfraRiskSnapshot {
  bounce: number
  spam: number
  fatigue: number
  overall: number
  signals: string[]
}

export interface CopilotSystemContext {
  systemStatus: CopilotSystemStatus
  riskLevel: CopilotRiskLevel
  campaigns: CopilotCampaignSnapshot[]
  domains: CopilotDomainSnapshot[]
  queue: CopilotQueueSnapshot
  performance: CopilotPerformanceSnapshot
  infraRisk: CopilotInfraRiskSnapshot
  recommendations: Array<{
    type: string
    title: string
    detail: string
    severity: 'info' | 'warning' | 'critical'
    suggestedTools?: Array<{ tool: string; args: Record<string, unknown> }>
  }>
  timestamp: string
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function round(value: number, digits: number): number {
  const p = 10 ** digits
  return Math.round(value * p) / p
}

function computeRiskLevel(overallRisk01: number): CopilotRiskLevel {
  if (overallRisk01 >= 0.75) return 'HIGH'
  if (overallRisk01 >= 0.4) return 'MEDIUM'
  return 'LOW'
}

export async function buildSystemContext(input?: {
  clientId?: number
  now?: Date
}): Promise<CopilotSystemContext> {
  const clientId = input?.clientId ?? appEnv.defaultClientId()
  const now = input?.now ?? new Date()

  if (isDemoModeEnabled()) {
    const demo = getDemoState()
    const replyRate = demo.beforeAfter.current.replyRate
    const bounceRate = demo.beforeAfter.current.bounceRate
    const overall = Math.min(0.35, bounceRate * 6 + 0.08) // low-ish risk
    const riskLevel: CopilotRiskLevel = overall >= 0.4 ? 'MEDIUM' : 'LOW'
    const systemStatus: CopilotSystemStatus = 'ACTIVE'

    return {
      systemStatus,
      riskLevel,
      campaigns: [
        {
          id: 12,
          name: 'Demo: SaaS Founders',
          status: 'active',
          sequenceId: 4,
          sequenceName: 'Cold outbound v2',
          contactCount: 1200,
          sentCount: 1180,
          replyCount: Math.round(1180 * replyRate),
          bounceCount: Math.round(1180 * bounceRate),
          openCount: 620,
          replyRate,
          bounceRate,
          openRate: 0.525,
          lastEnqueuedAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
        },
      ],
      domains: [
        {
          id: 3,
          domain: 'atlasmail.io',
          status: 'active',
          dailyLimit: 2500,
          dailyCap: 2500,
          sentToday: 1240,
          sentCount: 18240,
          bounceCount: 420,
          bounceRate: Math.round(bounceRate * 10000) / 100,
          spamRate: 0.18,
          healthScore: 92,
          reputationScore: 90,
          spfValid: true,
          dkimValid: true,
          dmarcValid: true,
          warmupStage: 3,
          pausedFlag: false,
          circuitBreakerUntil: null,
        },
      ],
      queue: {
        pending: 84,
        processing: 6,
        retry: 12,
        failed: 3,
        completed24h: 4030,
        avgScheduleLagSeconds: 4.2,
        oldestPendingSeconds: 28.4,
      },
      performance: {
        last24h: {
          sent: 4100,
          replies: Math.round(4100 * replyRate),
          bounces: Math.round(4100 * bounceRate),
          complaints: 0,
          replyRate: Math.round(replyRate * 10000) / 10000,
          bounceRate: Math.round(bounceRate * 10000) / 10000,
        },
        patterns: { top: [] },
      },
      infraRisk: {
        bounce: Math.round(bounceRate * 10000) / 10000,
        spam: 0.0018,
        fatigue: 0.04,
        overall: Math.round(overall * 10000) / 10000,
        signals: ['Demo Mode: synthetic telemetry'],
      },
      recommendations: [
        {
          type: 'demo',
          title: 'Rotate subject patterns',
          detail: 'Reply softness detected. Rotate to Pattern C to reduce fatigue.',
          severity: 'info',
          suggestedTools: [{ tool: 'updateSequence', args: { sequenceId: 4 } }],
        },
      ],
      timestamp: now.toISOString(),
    }
  }

  const [
    campaignsResult,
    domainsResult,
    queueResult,
    recentEventsResult,
    patternsStore,
  ] = await Promise.all([
    query<any>(
      `
      SELECT
        c.id,
        c.name,
        c.status,
        c.sequence_id,
        s.name as sequence_name,
        c.contact_count,
        c.sent_count,
        c.reply_count,
        c.bounce_count,
        c.open_count,
        c.last_enqueued_at
      FROM campaigns c
      JOIN sequences s ON s.id = c.sequence_id
      WHERE c.client_id = $1
      ORDER BY c.updated_at DESC
      LIMIT 50
    `,
      [clientId],
    ),
    query<any>(
      `
      SELECT
        id,
        domain,
        status,
        paused as paused_flag,
        daily_limit,
        daily_cap,
        sent_today,
        sent_count,
        bounce_count,
        bounce_rate,
        spam_rate,
        health_score,
        reputation_score,
        spf_valid,
        dkim_valid,
        dmarc_valid,
        warmup_stage,
        circuit_breaker_until
      FROM domains
      WHERE client_id = $1
      ORDER BY status ASC, health_score DESC, reputation_score DESC, updated_at DESC
      LIMIT 100
    `,
      [clientId],
    ),
    query<any>(
      `
      WITH lag AS (
        SELECT
          EXTRACT(EPOCH FROM (NOW() - scheduled_at)) AS lag_seconds
        FROM queue_jobs
        WHERE client_id = $1
          AND status IN ('pending','retry')
        ORDER BY scheduled_at ASC
        LIMIT 5000
      ),
      oldest AS (
        SELECT
          EXTRACT(EPOCH FROM (NOW() - MIN(scheduled_at))) AS oldest_seconds
        FROM queue_jobs
        WHERE client_id = $1
          AND status IN ('pending','retry')
      )
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::int as pending,
        COUNT(*) FILTER (WHERE status = 'processing')::int as processing,
        COUNT(*) FILTER (WHERE status = 'retry')::int as retry,
        COUNT(*) FILTER (WHERE status = 'failed')::int as failed,
        COUNT(*) FILTER (WHERE status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours')::int as completed_24h,
        COALESCE((SELECT AVG(lag_seconds) FROM lag), 0)::float as avg_lag_seconds,
        COALESCE((SELECT oldest_seconds FROM oldest), 0)::float as oldest_pending_seconds
      FROM queue_jobs
      WHERE client_id = $1
    `,
      [clientId],
    ),
    query<any>(
      `
      SELECT
        event_type,
        COUNT(*)::int as count
      FROM events
      WHERE client_id = $1
        AND created_at > NOW() - INTERVAL '24 hours'
      GROUP BY event_type
    `,
      [clientId],
    ),
    loadPatternStore(),
  ])

  const campaigns: CopilotCampaignSnapshot[] = campaignsResult.rows.map((row: any) => {
    const sent = Number(row.sent_count ?? 0) || 0
    const replies = Number(row.reply_count ?? 0) || 0
    const bounces = Number(row.bounce_count ?? 0) || 0
    const opens = Number(row.open_count ?? 0) || 0
    return {
      id: Number(row.id),
      name: String(row.name),
      status: row.status,
      sequenceId: Number(row.sequence_id),
      sequenceName: String(row.sequence_name ?? ''),
      contactCount: Number(row.contact_count ?? 0) || 0,
      sentCount: sent,
      replyCount: replies,
      bounceCount: bounces,
      openCount: opens,
      replyRate: sent > 0 ? round(replies / sent, 4) : 0,
      bounceRate: sent > 0 ? round(bounces / sent, 4) : 0,
      openRate: sent > 0 ? round(opens / sent, 4) : 0,
      lastEnqueuedAt: row.last_enqueued_at ? new Date(row.last_enqueued_at).toISOString() : null,
    }
  })

  const domains: CopilotDomainSnapshot[] = domainsResult.rows.map((row: any) => ({
    id: Number(row.id),
    domain: String(row.domain),
    status: row.status,
    dailyLimit: Number(row.daily_limit ?? 0) || 0,
    dailyCap: row.daily_cap !== null && row.daily_cap !== undefined ? Number(row.daily_cap) : null,
    sentToday: Number(row.sent_today ?? 0) || 0,
    sentCount: Number(row.sent_count ?? 0) || 0,
    bounceCount: Number(row.bounce_count ?? 0) || 0,
    bounceRate: Number(row.bounce_rate ?? 0) || 0,
    spamRate: Number(row.spam_rate ?? 0) || 0,
    healthScore: Number(row.health_score ?? 0) || 0,
    reputationScore: Number(row.reputation_score ?? 0) || 0,
    spfValid: Boolean(row.spf_valid),
    dkimValid: Boolean(row.dkim_valid),
    dmarcValid: Boolean(row.dmarc_valid),
    warmupStage: Number(row.warmup_stage ?? 0) || 0,
    pausedFlag: Boolean(row.paused_flag),
    circuitBreakerUntil: row.circuit_breaker_until ? new Date(row.circuit_breaker_until).toISOString() : null,
  }))

  const queue: CopilotQueueSnapshot = {
    pending: Number(queueResult.rows[0]?.pending ?? 0) || 0,
    processing: Number(queueResult.rows[0]?.processing ?? 0) || 0,
    retry: Number(queueResult.rows[0]?.retry ?? 0) || 0,
    failed: Number(queueResult.rows[0]?.failed ?? 0) || 0,
    completed24h: Number(queueResult.rows[0]?.completed_24h ?? 0) || 0,
    avgScheduleLagSeconds: round(Number(queueResult.rows[0]?.avg_lag_seconds ?? 0) || 0, 1),
    oldestPendingSeconds: round(Number(queueResult.rows[0]?.oldest_pending_seconds ?? 0) || 0, 1),
  }

  const eventsMap = new Map<string, number>()
  for (const row of recentEventsResult.rows) {
    eventsMap.set(String(row.event_type), Number(row.count ?? 0) || 0)
  }
  const sent24h = eventsMap.get('sent') ?? 0
  const replies24h = eventsMap.get('reply') ?? 0
  const bounces24h = eventsMap.get('bounce') ?? 0
  const complaints24h = eventsMap.get('complaint') ?? 0
  const replyRate24h = sent24h > 0 ? replies24h / sent24h : 0
  const bounceRate24h = sent24h > 0 ? bounces24h / sent24h : 0

  const topPatterns = patternsStore.patterns
    .slice()
    .filter((p) => p.status !== 'disabled')
    .sort((a, b) => (b.score - a.score) || (b.reply_rate - a.reply_rate) || (b.open_rate - a.open_rate))
    .slice(0, 10)

  // Infra risk is a bounded deterministic heuristic: we only use signals we can prove from DB.
  const avgBounce = domains.length
    ? domains.reduce((sum, d) => sum + clamp01(d.bounceRate / 100), 0) / domains.length
    : 0
  const avgSpam = domains.length
    ? domains.reduce((sum, d) => sum + clamp01(d.spamRate), 0) / domains.length
    : 0
  const fatigue = clamp01(queue.oldestPendingSeconds / (60 * 60)) // >1h backlog implies fatigue

  const signals: string[] = []
  if (domains.length === 0) signals.push('No domains configured')
  if (avgBounce >= 0.03) signals.push(`High average bounce signal (${round(avgBounce * 100, 2)}%)`)
  if (avgSpam >= 0.02) signals.push(`Spam placement signal elevated (${round(avgSpam * 100, 2)}%)`)
  if (fatigue >= 0.6) signals.push(`Queue backlog elevated (oldest ${Math.round(queue.oldestPendingSeconds)}s)`)
  if (complaints24h > 0) signals.push(`${complaints24h} complaint event(s) in last 24h`)

  const overallRisk = clamp01(avgBounce * 1.8 + avgSpam * 2.5 + fatigue * 0.6 + (complaints24h > 0 ? 0.2 : 0))
  const infraRisk: CopilotInfraRiskSnapshot = {
    bounce: round(avgBounce, 4),
    spam: round(avgSpam, 4),
    fatigue: round(fatigue, 4),
    overall: round(overallRisk, 4),
    signals,
  }

  const riskLevel = computeRiskLevel(overallRisk)

  let systemStatus: CopilotSystemStatus = 'ACTIVE'
  if (domains.length === 0) systemStatus = 'SETUP_REQUIRED'
  if (riskLevel === 'HIGH') systemStatus = 'DEGRADED'

  const recommendations: CopilotSystemContext['recommendations'] = []
  if (domains.length === 0) {
    recommendations.push({
      type: 'setup',
      title: 'Add a sending domain',
      detail: 'No domains exist yet. Add at least one domain to unlock infrastructure health, send rate control, and warmup.',
      severity: 'warning',
      suggestedTools: [],
    })
  }

  if (replyRate24h < 0.005 && sent24h >= 100) {
    recommendations.push({
      type: 'performance',
      title: 'Reply rate is low',
      detail: `Reply rate is ${round(replyRate24h * 100, 2)}% in the last 24h (sent=${sent24h}). Consider rotating top subject patterns or tightening targeting.`,
      severity: 'warning',
      suggestedTools: [{ tool: 'getTopPatterns', args: { limit: 5 } }],
    })
  }

  if (bounceRate24h >= 0.03 && sent24h >= 50) {
    recommendations.push({
      type: 'risk',
      title: 'Bounce rate elevated',
      detail: `Bounce rate is ${round(bounceRate24h * 100, 2)}% in the last 24h (bounces=${bounces24h}, sent=${sent24h}). Consider lowering send rate and reviewing domains with low authentication.`,
      severity: 'critical',
      suggestedTools: [{ tool: 'adjustSendRate', args: { mode: 'reduce_20pct' } }],
    })
  }

  return {
    systemStatus,
    riskLevel,
    campaigns,
    domains,
    queue,
    performance: {
      last24h: {
        sent: sent24h,
        replies: replies24h,
        bounces: bounces24h,
        complaints: complaints24h,
        replyRate: round(replyRate24h, 4),
        bounceRate: round(bounceRate24h, 4),
      },
      patterns: {
        top: topPatterns,
      },
    },
    infraRisk,
    recommendations,
    timestamp: now.toISOString(),
  }
}
