import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { resolveClientId } from '@/lib/client-context'

type Provider = 'gmail' | 'outlook' | 'yahoo' | 'other'
type LaneStatus = 'HEALTHY' | 'THROTTLED' | 'PAUSED'

const PROVIDERS: Provider[] = ['gmail', 'outlook', 'yahoo', 'other']

const PROVIDER_LABELS: Record<Provider, string> = {
  gmail: 'Gmail',
  outlook: 'Outlook',
  yahoo: 'Yahoo',
  other: 'iCloud',
}

type DomainRow = {
  id: string | number
  domain: string
  status: string
  daily_limit: string | number | null
}

type StateRow = {
  id: string | number
  client_id: string | number
  domain_id: string | number
  domain: string
  domain_daily_limit: string | number | null
  provider: Provider
  state: 'warmup' | 'normal' | 'degraded' | 'cooldown' | 'paused'
  max_per_hour: string | number
  max_per_minute: string | number
  max_concurrency: string | number
  cooldown_until: string | null
  reasons: unknown
  metrics_snapshot: unknown
  updated_at: string
  deferral_rate_1h: string | number | null
  block_rate_1h: string | number | null
  send_success_rate_1h: string | number | null
  throttle_factor: string | number | null
  provider_snapshot_at: string | null
  seed_inbox_rate_24h: string | number | null
  seed_sample_24h: string | number | null
}

type EventRow = {
  id: string | number
  created_at: string
  provider: Provider | null
  event_type: string
  severity: 'info' | 'warning' | 'critical'
  message: string
  domain_id: string | number | null
  domain: string | null
  previous_state: unknown
  next_state: unknown
  metrics_snapshot: unknown
}

type RampRow = {
  created_at: string
  provider: Provider
  domain_id: string | number | null
  domain: string | null
  max_per_hour: string | number | null
}

type InvestorRow = {
  sent_today: string
  replies_today: string
  bounces_today: string
  complaints_today: string
  domains_active: string
  active_capacity_per_hour: string
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function metricFromSnapshot(row: StateRow, names: string[], fallback: unknown) {
  const snapshot = asRecord(row.metrics_snapshot)
  const nested = asRecord(snapshot.metrics)
  const signal = asRecord(snapshot.signal)
  const signalMetrics = asRecord(signal.metrics)

  for (const name of names) {
    const value = nested[name] ?? signalMetrics[name] ?? snapshot[name]
    if (value !== undefined && value !== null && value !== '') return value
  }

  return fallback
}

function normalizeJsonArray(value: unknown): string[] {
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

function laneStatus(row: StateRow): LaneStatus {
  const maxPerHour = toNumber(row.max_per_hour)
  const state = row.state
  const throttleFactor = toNumber(row.throttle_factor, 1)
  const deferralRate = toNumber(
    metricFromSnapshot(row, ['deferralRate1h', 'deferral_rate_1h', 'deferral_rate'], row.deferral_rate_1h)
  )
  const blockRate = toNumber(
    metricFromSnapshot(row, ['blockRate1h', 'block_rate_1h', 'block_rate'], row.block_rate_1h)
  )

  if (state === 'paused' || maxPerHour <= 0) return 'PAUSED'
  if (
    state === 'warmup' ||
    state === 'degraded' ||
    state === 'cooldown' ||
    throttleFactor < 0.95 ||
    deferralRate >= 0.02 ||
    blockRate > 0
  ) {
    return 'THROTTLED'
  }
  return 'HEALTHY'
}

function summarizeProvider(provider: Provider, rows: StateRow[]) {
  const providerRows = rows.filter((row) => row.provider === provider)
  const statuses = providerRows.map(laneStatus)
  const status: LaneStatus = !providerRows.length
    ? 'THROTTLED'
    : statuses.includes('PAUSED')
    ? 'PAUSED'
    : statuses.includes('THROTTLED')
      ? 'THROTTLED'
      : 'HEALTHY'

  const maxPerHour = providerRows.reduce((sum, row) => sum + toNumber(row.max_per_hour), 0)
  const maxConcurrency = providerRows.reduce((sum, row) => sum + toNumber(row.max_concurrency), 0)
  const avgMetric = (names: string[], key: keyof StateRow, fallback = 0) => {
    if (!providerRows.length) return fallback
    return (
      providerRows.reduce((sum, row) => sum + toNumber(metricFromSnapshot(row, names, row[key]), fallback), 0) /
      providerRows.length
    )
  }

  return {
    provider,
    label: PROVIDER_LABELS[provider],
    status,
    domains: providerRows.length,
    pausedDomains: statuses.filter((item) => item === 'PAUSED').length,
    throttledDomains: statuses.filter((item) => item === 'THROTTLED').length,
    maxPerHour,
    maxConcurrency,
    deferralRate1h: avgMetric(['deferralRate1h', 'deferral_rate_1h', 'deferral_rate'], 'deferral_rate_1h'),
    blockRate1h: avgMetric(['blockRate1h', 'block_rate_1h', 'block_rate'], 'block_rate_1h'),
    sendSuccessRate1h: avgMetric(['sendSuccessRate1h', 'success_rate_1h', 'success_rate'], 'send_success_rate_1h', 1),
    seedPlacementInboxRate: avgMetric(
      ['seedPlacementInboxRate', 'seed_placement_inbox_rate', 'inbox_placement_rate'],
      'seed_inbox_rate_24h',
      1
    ),
    seedSample24h: providerRows.reduce((sum, row) => sum + toNumber(row.seed_sample_24h), 0),
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const clientId = await resolveClientId({
      searchParams,
      headers: request.headers,
    })
    const domainId = Number(searchParams.get('domain_id') ?? 0) || null

    const domainParams: unknown[] = [clientId]
    const domainWhere = ['client_id = $1']
    if (domainId) {
      domainParams.push(domainId)
      domainWhere.push(`id = $${domainParams.length}`)
    }

    const [domainResult, stateResult, eventResult, rampResult, investorResult] = await Promise.all([
      query<DomainRow>(
        `SELECT id, domain, status, daily_limit
         FROM domains
         WHERE ${domainWhere.join(' AND ')}
         ORDER BY domain ASC`,
        domainParams
      ),
      query<StateRow>(
        `SELECT
           rs.id,
           rs.client_id,
           rs.domain_id,
           d.domain,
           d.daily_limit AS domain_daily_limit,
           rs.provider,
           rs.state,
           rs.max_per_hour,
           rs.max_per_minute,
           rs.max_concurrency,
           rs.cooldown_until,
           rs.reasons,
           rs.metrics_snapshot,
           rs.updated_at,
           ph.deferral_rate AS deferral_rate_1h,
           ph.block_rate AS block_rate_1h,
           ph.success_rate AS send_success_rate_1h,
           ph.throttle_factor,
           ph.created_at AS provider_snapshot_at,
           seed.seed_inbox_rate_24h,
           seed.seed_sample_24h
         FROM reputation_state rs
         JOIN domains d ON d.id = rs.domain_id
         LEFT JOIN LATERAL (
           SELECT deferral_rate, block_rate, success_rate, throttle_factor, created_at
           FROM provider_health_snapshots ph
           WHERE ph.client_id = rs.client_id
             AND ph.provider = rs.provider
             AND (ph.domain_id = rs.domain_id OR ph.domain_id IS NULL)
           ORDER BY
             CASE WHEN ph.domain_id = rs.domain_id THEN 0 ELSE 1 END,
             ph.created_at DESC
           LIMIT 1
         ) ph ON true
         LEFT JOIN LATERAL (
           SELECT
             COALESCE(AVG(CASE WHEN placement = 'inbox' THEN 1 ELSE 0 END), 1) AS seed_inbox_rate_24h,
             COUNT(*) AS seed_sample_24h
           FROM seed_placement_events spe
           WHERE spe.client_id = rs.client_id
             AND spe.provider = rs.provider
             AND spe.created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
         ) seed ON true
         WHERE rs.client_id = $1
           AND ($2::bigint IS NULL OR rs.domain_id = $2::bigint)
         ORDER BY d.domain ASC, rs.provider ASC`,
        [clientId, domainId]
      ),
      query<EventRow>(
        `SELECT
           re.id,
           re.created_at,
           re.provider,
           re.event_type,
           re.severity,
           re.message,
           re.domain_id,
           d.domain,
           re.previous_state,
           re.next_state,
           re.metrics_snapshot
         FROM reputation_events re
         LEFT JOIN domains d ON d.id = re.domain_id
         WHERE re.client_id = $1
           AND ($2::bigint IS NULL OR re.domain_id = $2::bigint)
         ORDER BY re.created_at DESC
         LIMIT 80`,
        [clientId, domainId]
      ),
      query<RampRow>(
        `SELECT
           re.created_at,
           re.provider,
           re.domain_id,
           d.domain,
           NULLIF(re.next_state->>'max_per_hour', '')::int AS max_per_hour
         FROM reputation_events re
         LEFT JOIN domains d ON d.id = re.domain_id
         WHERE re.client_id = $1
           AND re.provider IS NOT NULL
           AND re.next_state ? 'max_per_hour'
           AND ($2::bigint IS NULL OR re.domain_id = $2::bigint)
         ORDER BY re.created_at ASC
         LIMIT 300`,
        [clientId, domainId]
      ),
      query<InvestorRow>(
        `SELECT
           COUNT(*) FILTER (WHERE e.event_type = 'sent' AND e.created_at >= CURRENT_DATE)::text AS sent_today,
           COUNT(*) FILTER (WHERE e.event_type = 'reply' AND e.created_at >= CURRENT_DATE)::text AS replies_today,
           COUNT(*) FILTER (WHERE e.event_type = 'bounce' AND e.created_at >= CURRENT_DATE)::text AS bounces_today,
           COUNT(*) FILTER (WHERE e.event_type = 'complaint' AND e.created_at >= CURRENT_DATE)::text AS complaints_today,
           (SELECT COUNT(*)::text FROM domains d WHERE d.client_id = $1 AND d.status = 'active') AS domains_active,
           (SELECT COALESCE(SUM(rs.max_per_hour), 0)::text
            FROM reputation_state rs
            WHERE rs.client_id = $1
              AND rs.state <> 'paused'
              AND ($2::bigint IS NULL OR rs.domain_id = $2::bigint)) AS active_capacity_per_hour
         FROM events e
         WHERE e.client_id = $1
           AND ($2::bigint IS NULL OR e.domain_id = $2::bigint)`,
        [clientId, domainId]
      ),
    ])

    const states = stateResult.rows.map((row) => ({
      id: Number(row.id),
      clientId: Number(row.client_id),
      domainId: Number(row.domain_id),
      domain: row.domain,
      domainDailyLimit: toNumber(row.domain_daily_limit),
      provider: row.provider,
      label: PROVIDER_LABELS[row.provider],
      state: row.state,
      status: laneStatus(row),
      maxPerHour: toNumber(row.max_per_hour),
      maxPerMinute: toNumber(row.max_per_minute),
      maxConcurrency: toNumber(row.max_concurrency),
      cooldownUntil: row.cooldown_until,
      reasons: normalizeJsonArray(row.reasons),
      updatedAt: row.updated_at,
      deferralRate1h: toNumber(
        metricFromSnapshot(row, ['deferralRate1h', 'deferral_rate_1h', 'deferral_rate'], row.deferral_rate_1h)
      ),
      blockRate1h: toNumber(
        metricFromSnapshot(row, ['blockRate1h', 'block_rate_1h', 'block_rate'], row.block_rate_1h)
      ),
      sendSuccessRate1h: toNumber(
        metricFromSnapshot(row, ['sendSuccessRate1h', 'success_rate_1h', 'success_rate'], row.send_success_rate_1h),
        1
      ),
      throttleFactor: toNumber(row.throttle_factor, 1),
      providerSnapshotAt: row.provider_snapshot_at,
      seedPlacementInboxRate: toNumber(
        metricFromSnapshot(
          row,
          ['seedPlacementInboxRate', 'seed_placement_inbox_rate', 'inbox_placement_rate'],
          row.seed_inbox_rate_24h
        ),
        1
      ),
      seedSample24h: toNumber(row.seed_sample_24h),
      metricsSnapshot: row.metrics_snapshot,
    }))
    const investor = investorResult.rows[0]
    const leadValueUsd = toNumber(process.env.INVESTOR_LEAD_VALUE_USD, 0.5)
    const costPerSendUsd = toNumber(process.env.COST_PER_SEND, 0.002)
    const sentToday = toNumber(investor?.sent_today)
    const sendingCostsUsd = sentToday * costPerSendUsd
    const avgInboxPlacementRate = states.length
      ? states.reduce((sum, row) => sum + row.seedPlacementInboxRate, 0) / states.length
      : 1
    const estimatedInboxedToday = Math.floor(sentToday * Math.max(0, Math.min(1, avgInboxPlacementRate)))
    const valueGeneratedUsd = estimatedInboxedToday * leadValueUsd
    const projectedDailyCapacity = toNumber(investor?.active_capacity_per_hour) * 10

    return NextResponse.json({
      ok: true,
      clientId,
      domainId,
      generatedAt: new Date().toISOString(),
      domains: domainResult.rows.map((row) => ({
        id: Number(row.id),
        domain: row.domain,
        status: row.status,
        dailyLimit: toNumber(row.daily_limit),
      })),
      providers: PROVIDERS.map((provider) => summarizeProvider(provider, stateResult.rows)),
      states,
      events: eventResult.rows.map((row) => ({
        id: Number(row.id),
        createdAt: row.created_at,
        provider: row.provider,
        label: row.provider ? PROVIDER_LABELS[row.provider] : 'System',
        eventType: row.event_type,
        severity: row.severity,
        message: row.message,
        domainId: row.domain_id ? Number(row.domain_id) : null,
        domain: row.domain,
        previousState: row.previous_state,
        nextState: row.next_state,
        metricsSnapshot: row.metrics_snapshot,
      })),
      ramp: rampResult.rows.map((row) => ({
        createdAt: row.created_at,
        provider: row.provider,
        label: PROVIDER_LABELS[row.provider],
        domainId: row.domain_id ? Number(row.domain_id) : null,
        domain: row.domain,
        maxPerHour: toNumber(row.max_per_hour),
      })),
      investor: {
        leadValueUsd,
        costPerSendUsd,
        sentToday,
        repliesToday: toNumber(investor?.replies_today),
        bouncesToday: toNumber(investor?.bounces_today),
        complaintsToday: toNumber(investor?.complaints_today),
        activeDomains: toNumber(investor?.domains_active),
        activeCapacityPerHour: toNumber(investor?.active_capacity_per_hour),
        projectedDailyCapacity,
        estimatedInboxedToday,
        avgInboxPlacementRate,
        valueGeneratedUsd,
        sendingCostsUsd,
        grossMarginUsd: valueGeneratedUsd - sendingCostsUsd,
        roiMultiple: sendingCostsUsd > 0 ? valueGeneratedUsd / sendingCostsUsd : null,
      },
    })
  } catch (error) {
    console.error('[api/reputation/monitor] failed', error)
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 })
  }
}
