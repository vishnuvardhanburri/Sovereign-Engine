import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

type Provider = 'gmail' | 'outlook' | 'yahoo' | 'other'

const PROVIDERS: Provider[] = ['gmail', 'outlook', 'yahoo', 'other']

const PROVIDER_LABELS: Record<Provider, string> = {
  gmail: 'Gmail',
  outlook: 'Outlook',
  yahoo: 'Yahoo',
  other: 'iCloud/Other',
}

type DomainRow = {
  id: string | number
  domain: string
  status: string
  health_score: string | number | null
  bounce_rate: string | number | null
  spam_rate: string | number | null
  sent_today: string | number | null
  daily_limit: string | number | null
}

type LaneRow = {
  provider: Provider
  state: string
  max_per_hour: string | number | null
  max_per_minute: string | number | null
  max_concurrency: string | number | null
  reasons: unknown
  metrics_snapshot: any
  updated_at: string | null
}

function normalizeDomain(raw: string) {
  const decoded = decodeURIComponent(raw || '').trim().toLowerCase()
  const withoutProtocol = decoded.replace(/^https?:\/\//, '')
  return withoutProtocol.split('/')[0]!.replace(/^www\./, '')
}

function toNumber(value: unknown, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function reasons(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  }
  return []
}

function grade(score: number) {
  if (score >= 90) return 'A'
  if (score >= 80) return 'B'
  if (score >= 70) return 'C'
  if (score >= 60) return 'D'
  return 'F'
}

function laneStatus(row: LaneRow) {
  const state = row.state
  const maxPerHour = toNumber(row.max_per_hour)
  if (state === 'paused' || maxPerHour <= 0) return 'PAUSED'
  if (state === 'warmup' || state === 'degraded' || state === 'cooldown') return 'THROTTLED'
  return 'HEALTHY'
}

function scoreLane(row: LaneRow) {
  const metrics = row.metrics_snapshot?.metrics ?? row.metrics_snapshot ?? {}
  const deferral = clamp(toNumber(metrics.deferralRate1h), 0, 1)
  const block = clamp(toNumber(metrics.blockRate1h), 0, 1)
  const seed = clamp(toNumber(metrics.seedPlacementInboxRate, 1), 0, 1)
  const statePenalty =
    row.state === 'paused' ? 45 : row.state === 'cooldown' ? 30 : row.state === 'degraded' ? 18 : row.state === 'warmup' ? 8 : 0
  return clamp(Math.round(100 - statePenalty - deferral * 260 - block * 500 - (1 - seed) * 40), 0, 100)
}

function recommendations(input: { domain: DomainRow | null; lanes: Array<{ status: string; score: number; reasons: string[] }> }) {
  const output: string[] = []
  if (!input.domain) {
    output.push('Domain is not yet observed by Xavira Orbit. Add DNS authentication checks and send seed traffic before scaling.')
    return output
  }
  if (input.domain.status !== 'active') output.push('Domain is not active. Resume only after fixing the pause reason.')
  if (toNumber(input.domain.bounce_rate) > 3) output.push('Bounce rate is elevated. Clean the list before increasing volume.')
  if (input.lanes.some((lane) => lane.status === 'PAUSED')) output.push('At least one provider lane is paused. Keep that lane stopped until block signals clear.')
  if (input.lanes.some((lane) => lane.score < 70)) output.push('One or more provider lanes are below safe ramp quality. Reduce throughput and monitor seed placement.')
  if (!output.length) output.push('Reputation Shield sees no critical blocker. Continue gradual safe-ramp and monitor provider lanes.')
  return output
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ domain: string }> }) {
  try {
    const requiredKey = process.env.REPUTATION_PUBLIC_API_KEY
    if (requiredKey && request.headers.get('x-api-key') !== requiredKey) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    }

    const { domain: rawDomain } = await params
    const domain = normalizeDomain(rawDomain)
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
      return NextResponse.json({ ok: false, error: 'invalid_domain' }, { status: 400 })
    }

    const domainResult = await query<DomainRow>(
      `SELECT id, domain, status, health_score, bounce_rate, spam_rate, sent_today, daily_limit
       FROM domains
       WHERE lower(domain) = $1
       ORDER BY updated_at DESC
       LIMIT 1`,
      [domain]
    )
    const domainRow = domainResult.rows[0] ?? null

    if (!domainRow) {
      return NextResponse.json({
        ok: true,
        product: 'reputation-shield',
        version: 'v1',
        domain,
        observed: false,
        score: 55,
        grade: 'D',
        status: 'UNKNOWN',
        generatedAt: new Date().toISOString(),
        providerLanes: PROVIDERS.map((provider) => ({
          provider,
          label: PROVIDER_LABELS[provider],
          status: 'UNKNOWN',
          score: 55,
          maxPerHour: 0,
          signals: null,
          reasons: ['domain_not_observed'],
        })),
        recommendations: recommendations({ domain: null, lanes: [] }),
      })
    }

    const laneResult = await query<LaneRow>(
      `SELECT provider, state, max_per_hour, max_per_minute, max_concurrency, reasons, metrics_snapshot, updated_at
       FROM reputation_state
       WHERE domain_id = $1
       ORDER BY provider ASC`,
      [domainRow.id]
    )

    const laneRowsByProvider = new Map(laneResult.rows.map((row) => [row.provider, row]))
    const providerLanes = PROVIDERS.map((provider) => {
      const row = laneRowsByProvider.get(provider)
      if (!row) {
        return {
          provider,
          label: PROVIDER_LABELS[provider],
          status: 'UNKNOWN',
          score: 60,
          maxPerHour: 0,
          maxPerMinute: 0,
          maxConcurrency: 0,
          signals: null,
          reasons: ['lane_not_initialized'],
          updatedAt: null,
        }
      }
      const metrics = row.metrics_snapshot?.metrics ?? row.metrics_snapshot ?? {}
      return {
        provider,
        label: PROVIDER_LABELS[provider],
        status: laneStatus(row),
        score: scoreLane(row),
        maxPerHour: toNumber(row.max_per_hour),
        maxPerMinute: toNumber(row.max_per_minute),
        maxConcurrency: toNumber(row.max_concurrency),
        signals: {
          deferralRate1h: toNumber(metrics.deferralRate1h),
          blockRate1h: toNumber(metrics.blockRate1h),
          sendSuccessRate1h: toNumber(metrics.sendSuccessRate1h, 1),
          seedPlacementInboxRate: toNumber(metrics.seedPlacementInboxRate, 1),
          providerRisk: toNumber(metrics.providerRisk),
        },
        reasons: reasons(row.reasons),
        updatedAt: row.updated_at,
      }
    })

    const baseScore = clamp(toNumber(domainRow.health_score, 70), 0, 100)
    const laneAverage = providerLanes.reduce((sum, lane) => sum + lane.score, 0) / Math.max(providerLanes.length, 1)
    const bouncePenalty = clamp(toNumber(domainRow.bounce_rate) * 2, 0, 25)
    const spamPenalty = clamp(toNumber(domainRow.spam_rate) * 100, 0, 25)
    const overall = clamp(Math.round(baseScore * 0.45 + laneAverage * 0.55 - bouncePenalty - spamPenalty), 0, 100)
    const status = providerLanes.some((lane) => lane.status === 'PAUSED')
      ? 'PAUSED'
      : providerLanes.some((lane) => lane.status === 'THROTTLED')
        ? 'THROTTLED'
        : 'HEALTHY'

    return NextResponse.json({
      ok: true,
      product: 'reputation-shield',
      version: 'v1',
      domain,
      observed: true,
      score: overall,
      grade: grade(overall),
      status,
      generatedAt: new Date().toISOString(),
      domainSignals: {
        status: domainRow.status,
        healthScore: toNumber(domainRow.health_score),
        bounceRate: toNumber(domainRow.bounce_rate),
        spamRate: toNumber(domainRow.spam_rate),
        sentToday: toNumber(domainRow.sent_today),
        dailyLimit: toNumber(domainRow.daily_limit),
      },
      providerLanes,
      recommendations: recommendations({ domain: domainRow, lanes: providerLanes }),
    })
  } catch (error) {
    console.error('[api/v1/reputation/score] failed', error)
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 })
  }
}
