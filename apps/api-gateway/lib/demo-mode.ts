/**
 * Demo Mode: synthetic overlay for buyer demos.
 *
 * Design goals:
 * - Must not write to real DB tables.
 * - Must never produce empty UI states.
 * - Must be deterministic enough to explain.
 *
 * Implementation:
 * - In-memory singleton state (good for local demo + long-running node process).
 * - API routes can opt-in to serving synthetic payloads when enabled.
 */

import { createClient } from 'redis'
import { appEnv } from '@/lib/env'

export type DemoModeStatus = {
  enabled: boolean
  updatedAt: string
}

export type DemoBeforeAfterSnapshot = {
  before: {
    replyRate: number // 0-1
    bounceRate: number // 0-1
  }
  current: {
    replyRate: number // 0-1
    bounceRate: number // 0-1
  }
}

export type DemoValueCounters = {
  conversationsToday: number
  opportunitiesToday: number
  estimatedPipelineValueUsd: number
}

export type DemoEventRow = {
  id: string
  event_type: string
  created_at: string
  campaign_id: number | null
  domain_id: number | null
  metadata: Record<string, unknown> | null
}

export type DemoImpactRow = {
  id: string
  client_id: number
  action_kind: string
  action_summary: string
  action_payload: any
  before_snapshot: any
  after_snapshot: any
  created_at: string
}

type DemoState = {
  enabled: boolean
  updatedAt: string
  seed: number
  day: number
  beforeAfter: DemoBeforeAfterSnapshot
  counters: DemoValueCounters
  events: DemoEventRow[]
  impacts: DemoImpactRow[]
}

const REDIS_KEY = 'demo:state:v1'

function nowIso(): string {
  return new Date().toISOString()
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(1, v))
}

function pctTo01(pct: number): number {
  return clamp01(pct / 100)
}

function id(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e9)}`
}

function seededJitter(seed: number, k: number): number {
  // tiny deterministic-ish jitter
  const x = Math.sin(seed * 999 + k * 7.3) * 10000
  return x - Math.floor(x)
}

function createInitialState(seed: number): DemoState {
  // "Before" is slightly worse; "current" looks improved + safe.
  const beforeReply = pctTo01(2.7)
  const beforeBounce = pctTo01(4.6)
  const currentReply = pctTo01(3.4)
  const currentBounce = pctTo01(2.9)

  const counters: DemoValueCounters = {
    conversationsToday: 34,
    opportunitiesToday: 9,
    estimatedPipelineValueUsd: 9 * 1200,
  }

  const baseCampaignId = 12
  const baseDomainId = 3

  const events: DemoEventRow[] = []
  for (let i = 0; i < 28; i++) {
    const t = Date.now() - i * 45_000
    const iso = new Date(t).toISOString()
    const roll = seededJitter(seed, i)
    const type = roll > 0.92 ? 'reply' : roll > 0.86 ? 'bounce' : 'sent'
    events.push({
      id: id('evt'),
      event_type: type,
      created_at: iso,
      campaign_id: baseCampaignId,
      domain_id: baseDomainId,
      metadata:
        type === 'reply'
          ? { reply_status: roll > 0.97 ? 'interested' : 'neutral' }
          : type === 'bounce'
            ? { reason: 'mailbox_not_found' }
            : null,
    })
  }

  const impacts: DemoImpactRow[] = [
    {
      id: id('imp'),
      client_id: 1,
      action_kind: 'adjust_send_rate',
      action_summary: 'Reduced send rate to protect domains during bounce spike',
      action_payload: { mode: 'reduce_20pct', reason: 'Bounce increased from 2.9% to 5.8% in last 2 hours' },
      before_snapshot: {
        performance: { last24h: { replyRate: beforeReply, bounceRate: pctTo01(5.8), sent: 1180 } },
      },
      after_snapshot: {
        performance: { last24h: { replyRate: currentReply, bounceRate: currentBounce, sent: 980 } },
      },
      created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: id('imp'),
      client_id: 1,
      action_kind: 'update_sequence',
      action_summary: 'Rotated subject line pattern to reduce fatigue',
      action_payload: { from: 'Pattern A', to: 'Pattern B' },
      before_snapshot: {
        performance: { last24h: { replyRate: pctTo01(3.0), bounceRate: currentBounce, sent: 920 } },
      },
      after_snapshot: {
        performance: { last24h: { replyRate: currentReply, bounceRate: currentBounce, sent: 980 } },
      },
      created_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    },
  ]

  return {
    enabled: true,
    updatedAt: nowIso(),
    seed,
    day: 0,
    beforeAfter: {
      before: { replyRate: beforeReply, bounceRate: beforeBounce },
      current: { replyRate: currentReply, bounceRate: currentBounce },
    },
    counters,
    events,
    impacts,
  }
}

// Local fallback (used if Redis is unavailable).
let localState: DemoState = {
  enabled: false,
  updatedAt: nowIso(),
  seed: 1,
  day: 0,
  beforeAfter: {
    before: { replyRate: 0, bounceRate: 0 },
    current: { replyRate: 0, bounceRate: 0 },
  },
  counters: { conversationsToday: 0, opportunitiesToday: 0, estimatedPipelineValueUsd: 0 },
  events: [],
  impacts: [],
}

let redisClient: any
let connectPromise: Promise<any> | undefined

async function getRedisClient(): Promise<any> {
  if (redisClient?.isOpen) return redisClient
  if (!connectPromise) {
    const client = createClient({
      url: appEnv.redisUrl(),
      socket: { reconnectStrategy: (retries) => Math.min(retries * 250, 3000) },
    })
    client.on('error', (error) => console.error('[Redis] Client error', error))
    connectPromise = client.connect().then(() => {
      redisClient = client
      return client
    })
  }
  return connectPromise
}

async function loadState(): Promise<DemoState> {
  try {
    const client = await getRedisClient()
    const raw = await client.get(REDIS_KEY)
    if (!raw) return localState
    const parsed = JSON.parse(raw) as DemoState
    if (!parsed || typeof parsed !== 'object') return localState
    localState = parsed
    return parsed
  } catch {
    return localState
  }
}

async function saveState(next: DemoState): Promise<void> {
  localState = next
  try {
    const client = await getRedisClient()
    await client.set(REDIS_KEY, JSON.stringify(next), { EX: 60 * 60 * 24 })
  } catch {
    // ignore: fall back to local state
  }
}

export async function getDemoModeStatus(): Promise<DemoModeStatus> {
  const s = await loadState()
  return { enabled: s.enabled, updatedAt: s.updatedAt }
}

export async function isDemoModeEnabled(): Promise<boolean> {
  const s = await loadState()
  return Boolean(s.enabled)
}

export async function getDemoState(): Promise<DemoState> {
  return loadState()
}

export async function setDemoModeEnabled(enabled: boolean): Promise<DemoModeStatus> {
  const cur = await loadState()
  if (enabled) {
    const seed = Math.floor(Math.random() * 1_000_000) + 1
    const next = createInitialState(seed)
    await saveState(next)
    return { enabled: true, updatedAt: next.updatedAt }
  }

  const next: DemoState = {
    enabled: false,
    updatedAt: nowIso(),
    seed: cur.seed,
    day: 0,
    beforeAfter: cur.beforeAfter,
    counters: cur.counters,
    events: [],
    impacts: [],
  }
  await saveState(next)
  return { enabled: false, updatedAt: next.updatedAt }
}

export async function simulateOneDay(): Promise<{ ok: true; state: DemoState } | { ok: false; error: string }> {
  const s = await loadState()
  if (!s.enabled) return { ok: false, error: 'DEMO_MODE is OFF' }

  const nextDay = s.day + 1
  const drift = 0.0025 + seededJitter(s.seed, nextDay) * 0.002

  const nextReply = clamp01(s.beforeAfter.current.replyRate + drift)
  const nextBounce = clamp01(Math.max(0.005, s.beforeAfter.current.bounceRate - drift * 0.9))

  const newCounters: DemoValueCounters = {
    conversationsToday: s.counters.conversationsToday + 8 + Math.floor(seededJitter(s.seed, nextDay) * 6),
    opportunitiesToday: s.counters.opportunitiesToday + 2 + Math.floor(seededJitter(s.seed, nextDay + 2) * 3),
    estimatedPipelineValueUsd: 0,
  }
  newCounters.estimatedPipelineValueUsd = newCounters.opportunitiesToday * 1200

  const newImpact: DemoImpactRow = {
    id: id('imp'),
    client_id: 1,
    action_kind: 'rotate_pattern',
    action_summary: 'Autonomous: Rotated top-performing pattern to sustain reply rate',
    action_payload: { from: 'Pattern B', to: 'Pattern C', safe: true },
    before_snapshot: { performance: { last24h: { replyRate: s.beforeAfter.current.replyRate, bounceRate: s.beforeAfter.current.bounceRate } } },
    after_snapshot: { performance: { last24h: { replyRate: nextReply, bounceRate: nextBounce } } },
    created_at: nowIso(),
  }

  const newEvents: DemoEventRow[] = []
  for (let i = 0; i < 36; i++) {
    const t = Date.now() - i * 35_000
    const iso = new Date(t).toISOString()
    const roll = seededJitter(s.seed + nextDay * 13, i)
    const type = roll > 0.9 ? 'reply' : roll > 0.86 ? 'bounce' : 'sent'
    newEvents.push({
      id: id('evt'),
      event_type: type,
      created_at: iso,
      campaign_id: 12,
      domain_id: 3,
      metadata:
        type === 'reply'
          ? { reply_status: roll > 0.95 ? 'interested' : 'neutral' }
          : type === 'bounce'
            ? { reason: 'policy_rejected' }
            : null,
    })
  }

  const next: DemoState = {
    ...s,
    updatedAt: nowIso(),
    day: nextDay,
    beforeAfter: {
      before: s.beforeAfter.before,
      current: { replyRate: nextReply, bounceRate: nextBounce },
    },
    counters: newCounters,
    events: [...newEvents, ...s.events].slice(0, 220),
    impacts: [newImpact, ...s.impacts].slice(0, 25),
  }

  await saveState(next)
  return { ok: true, state: next }
}

export async function demoExecutiveSummaryPayload(): Promise<any> {
  const s = await loadState()
  const todaySent = 1240 + s.day * 140
  const todayReplies = Math.round(todaySent * s.beforeAfter.current.replyRate)
  const todayBounces = Math.round(todaySent * s.beforeAfter.current.bounceRate)
  const interested = Math.max(1, Math.round(todayReplies * 0.27))
  const yesterdaySent = Math.max(300, todaySent - 220)
  const yesterdayReplyRate = clamp01(s.beforeAfter.current.replyRate - 0.003)
  const yesterdayBounceRate = clamp01(s.beforeAfter.current.bounceRate + 0.003)

  const replyTrend = yesterdayReplyRate > 0 ? (s.beforeAfter.current.replyRate - yesterdayReplyRate) / yesterdayReplyRate : 0

  return {
    timestamp: nowIso(),
    demoMode: true,
    today: {
      sent: todaySent,
      replies: todayReplies,
      interestedReplies: interested,
      bounces: todayBounces,
      replyRate: s.beforeAfter.current.replyRate,
      bounceRate: s.beforeAfter.current.bounceRate,
    },
    yesterday: {
      sent: yesterdaySent,
      replies: Math.round(yesterdaySent * yesterdayReplyRate),
      bounces: Math.round(yesterdaySent * yesterdayBounceRate),
      replyRate: yesterdayReplyRate,
      bounceRate: yesterdayBounceRate,
    },
    businessImpact: {
      estimatedConversationsToday: s.counters.conversationsToday,
      estimatedOpportunities: s.counters.opportunitiesToday,
      replyTrendPct: replyTrend,
    },
    safety: {
      complianceActive: true,
      blockedContactsToday: 3,
    },
    baseline: s.beforeAfter.before,
  }
}

export async function demoExecutiveForecastPayload(days = 5): Promise<any> {
  const s = await loadState()
  const bounceRisk = s.beforeAfter.current.bounceRate >= pctTo01(5) ? 'HIGH' : s.beforeAfter.current.bounceRate >= pctTo01(3) ? 'MEDIUM' : 'LOW'
  const avgReplyRate = clamp01(s.beforeAfter.current.replyRate - 0.0015)
  const avgBounceRate = clamp01(s.beforeAfter.current.bounceRate + 0.001)
  return {
    timestamp: nowIso(),
    demoMode: true,
    forecast: {
      expectedRepliesToday: Math.round((1240 + s.day * 140) * avgReplyRate),
      projectedBounceRisk: bounceRisk,
      estimatedSafeSendCapacityRemaining: 3200,
    },
    trends: {
      days,
      reply: { direction: 'up', changePct: 0.12, text: 'Reply rate improving by +12% over last 5 days' },
      bounce: { direction: 'down', changePct: -0.18, text: 'Bounce rate improving by -18% over last 5 days' },
    },
    earlyWarnings: bounceRisk === 'HIGH' ? ['Bounce risk likely to increase in the next 2–3 hours. Sending will be adjusted automatically.'] : [],
    baselines: { avgReplyRate, avgBounceRate },
  }
}

export async function demoInfrastructureAnalyticsPayload(): Promise<any> {
  const s = await loadState()
  // Keep shape aligned with /api/infrastructure/analytics.
  return {
    timestamp: nowIso(),
    demoMode: true,
    metrics: {
      domains: 4,
      healthyDomains: 4,
      inboxes: 9,
      capacity: { total: 9000, used: 4100, utilization: 46 },
      emails: { sent24h: 4100 + s.day * 250, avgDeliveryTime: 1.42 },
      health: {
        uptime: 99.9,
        avgBounceRate: Math.round(s.beforeAfter.current.bounceRate * 10000) / 100,
        avgSpamRate: 0.18,
      },
    },
    domains: [
      { id: 3, domain: 'atlasmail.io', health: 'healthy', paused: false, inboxes: 3, sent24h: 1260, bounceRate: 2.6, spamRate: 0.2, avgDeliveryTime: 1.2 },
      { id: 4, domain: 'northreach.ai', health: 'healthy', paused: false, inboxes: 2, sent24h: 980, bounceRate: 2.9, spamRate: 0.1, avgDeliveryTime: 1.4 },
      { id: 5, domain: 'vantaops.co', health: 'healthy', paused: false, inboxes: 2, sent24h: 910, bounceRate: 3.1, spamRate: 0.2, avgDeliveryTime: 1.6 },
      { id: 6, domain: 'safepipeline.dev', health: 'healthy', paused: false, inboxes: 2, sent24h: 780, bounceRate: 2.7, spamRate: 0.2, avgDeliveryTime: 1.5 },
    ],
    performance: {
      peakHour: 16,
      avgLoad: 170,
      maxLoad: 310,
      bottlenecks: [],
      insights: [
        'Queue lag is stable and within recovery thresholds.',
        'Domains are operating within safe deliverability boundaries.',
        'Reply rate trending upward after recent pattern rotation.',
      ],
    },
    recommendations: [
      {
        id: 'demo_rec_1',
        category: 'deliverability',
        priority: 'high',
        title: 'Reduce send rate to protect domains',
        description: 'Bounce increased from 2% to 6% in last 2h. Throttle to protect domain reputation and avoid provider blocks.',
        action: 'Reduce send rate by 20% for 2 hours and retry soft-bounces.',
        estimatedImpact: 'Expected: -35% bounces, +8% reply stability',
        confidence: 86,
      },
      {
        id: 'demo_rec_2',
        category: 'performance',
        priority: 'medium',
        title: 'Rotate subject patterns',
        description: 'Reply rate softness detected on top sequence. Rotate to Pattern C to reduce fatigue.',
        action: 'Switch the top 3 campaigns to Pattern C and monitor replies for 6 hours.',
        estimatedImpact: 'Expected: +12% replies',
        confidence: 78,
      },
    ],
  }
}

export async function demoEventsPayload(page = 1, limit = 50): Promise<any> {
  const s = await loadState()
  const rows = s.events.slice(0, limit)
  return {
    data: rows,
    pagination: {
      page,
      limit,
      total: rows.length,
      totalPages: 1,
    },
    demoMode: true,
  }
}

export async function demoImpactsPayload(limit = 10): Promise<any> {
  const s = await loadState()
  const rows = s.impacts.slice(0, limit)
  return {
    ok: true,
    demoMode: true,
    data: rows.map((r) => ({
      ...r,
      summaryLines: [
        `Improved reply rate by ${Math.round((clamp01((r.after_snapshot?.performance?.last24h?.replyRate ?? 0) - (r.before_snapshot?.performance?.last24h?.replyRate ?? 0)) * 100) * 100) / 100}%`,
        `Reduced bounce rate by ${Math.round((clamp01(((r.before_snapshot?.performance?.last24h?.bounceRate ?? 0) - (r.after_snapshot?.performance?.last24h?.bounceRate ?? 0)) * 100)) * 100) / 100}%`,
      ],
    })),
  }
}
