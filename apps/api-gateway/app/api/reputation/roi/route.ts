import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { resolveClientId } from '@/lib/client-context'
import { calculateRoiOracle } from '@/lib/roi-oracle'

type EventAggregateRow = {
  sent_today: string
  delivered_today: string
  clicked_today: string
  replies_today: string
  bounces_today: string
  complaints_today: string
}

type SeedRow = {
  sample: string
  inbox_rate: string | number | null
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const clientId = await resolveClientId({ searchParams, headers: request.headers })
    const domainId = Number(searchParams.get('domain_id') ?? 0) || null

    const [events, seeds] = await Promise.all([
      query<EventAggregateRow>(
        `SELECT
           COUNT(*) FILTER (WHERE event_type = 'sent' AND created_at >= CURRENT_DATE)::text AS sent_today,
           COUNT(*) FILTER (WHERE event_type = 'delivered' AND created_at >= CURRENT_DATE)::text AS delivered_today,
           COUNT(*) FILTER (WHERE event_type = 'clicked' AND created_at >= CURRENT_DATE)::text AS clicked_today,
           COUNT(*) FILTER (WHERE event_type = 'reply' AND created_at >= CURRENT_DATE)::text AS replies_today,
           COUNT(*) FILTER (WHERE event_type = 'bounce' AND created_at >= CURRENT_DATE)::text AS bounces_today,
           COUNT(*) FILTER (WHERE event_type = 'complaint' AND created_at >= CURRENT_DATE)::text AS complaints_today
         FROM events
         WHERE client_id = $1
           AND ($2::bigint IS NULL OR domain_id = $2::bigint)`,
        [clientId, domainId]
      ),
      query<SeedRow>(
        `SELECT
           COUNT(*)::text AS sample,
           COALESCE(AVG(CASE WHEN placement = 'inbox' THEN 1 ELSE 0 END), 1) AS inbox_rate
         FROM seed_placement_events
         WHERE client_id = $1
           AND created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'`,
        [clientId]
      ),
    ])

    const eventRow = events.rows[0]
    const seedRow = seeds.rows[0]
    const roi = calculateRoiOracle({
      sent: toNumber(eventRow?.sent_today),
      delivered: toNumber(eventRow?.delivered_today),
      clicked: toNumber(eventRow?.clicked_today),
      replies: toNumber(eventRow?.replies_today),
      bounces: toNumber(eventRow?.bounces_today),
      complaints: toNumber(eventRow?.complaints_today),
      inboxPlacementRate: toNumber(seedRow?.inbox_rate, 1),
      leadValueUsd: toNumber(process.env.ROI_INBOX_LEAD_VALUE_USD ?? process.env.INVESTOR_LEAD_VALUE_USD, 0.75),
      costPerSendUsd: toNumber(process.env.ROI_COST_PER_SEND_USD ?? process.env.COST_PER_SEND, 0.002),
      infraDailyUsd: toNumber(process.env.ROI_INFRA_DAILY_USD, 0),
      proxyDailyUsd: toNumber(process.env.ROI_PROXY_DAILY_USD, 0),
      domainDailyUsd: toNumber(process.env.ROI_DOMAIN_DAILY_USD, 0),
    })

    return NextResponse.json({
      ok: true,
      clientId,
      domainId,
      generatedAt: new Date().toISOString(),
      seedSample24h: toNumber(seedRow?.sample),
      roi,
    })
  } catch (error) {
    console.error('[api/reputation/roi] failed', error)
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 })
  }
}
