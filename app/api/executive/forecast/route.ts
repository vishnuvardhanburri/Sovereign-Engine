import { NextRequest, NextResponse } from 'next/server'
import { resolveClientId } from '@/lib/client-context'
import { query, queryOne } from '@/lib/db'

type DayRateRow = {
  day: string
  sent: string | number | null
  replies: string | number | null
  bounces: string | number | null
}

function n(value: unknown): number {
  const out = Number(value)
  return Number.isFinite(out) ? out : 0
}

function rate(num: number, den: number): number {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return 0
  return num / den
}

function riskLabel(value: number, low: number, med: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (value >= med) return 'HIGH'
  if (value >= low) return 'MEDIUM'
  return 'LOW'
}

function trendText(kind: 'reply' | 'bounce', change: number, days: number): string {
  const pct = Math.round(change * 100)
  const sign = pct >= 0 ? '+' : ''
  const label = kind === 'reply' ? 'Reply rate' : 'Bounce rate'
  const direction = pct >= 0 ? 'improving' : 'declining'
  // bounce "improving" means decreasing, so flip wording
  if (kind === 'bounce') {
    const bounceDir = pct <= 0 ? 'improving' : 'worsening'
    return `${label} ${bounceDir} by ${sign}${pct}% over last ${days} days`
  }
  return `${label} ${direction} by ${sign}${pct}% over last ${days} days`
}

export async function GET(request: NextRequest) {
  try {
    const clientId = await resolveClientId({
      searchParams: request.nextUrl.searchParams,
      headers: request.headers,
    })

    const days = Math.max(3, Math.min(5, Number(request.nextUrl.searchParams.get('days') ?? 5) || 5))

    const daily = await query<DayRateRow>(
      `
      SELECT
        date_trunc('day', created_at)::date::text AS day,
        COUNT(*) FILTER (WHERE event_type = 'sent')::text AS sent,
        COUNT(*) FILTER (WHERE event_type = 'reply')::text AS replies,
        COUNT(*) FILTER (WHERE event_type = 'bounce')::text AS bounces
      FROM events
      WHERE client_id = $1
        AND created_at >= date_trunc('day', NOW()) - ($2::int * INTERVAL '1 day')
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT $2
      `,
      [clientId, days]
    )

    const series = daily.rows.map((r) => {
      const sent = n(r.sent)
      const replies = n(r.replies)
      const bounces = n(r.bounces)
      return {
        day: r.day,
        sent,
        replies,
        bounces,
        replyRate: rate(replies, sent),
        bounceRate: rate(bounces, sent),
      }
    })

    const avgReplyRate = series.length > 0 ? series.reduce((s, d) => s + d.replyRate, 0) / series.length : 0
    const avgBounceRate = series.length > 0 ? series.reduce((s, d) => s + d.bounceRate, 0) / series.length : 0

    const first = series[series.length - 1]
    const last = series[0]

    const replyTrend = first ? rate(last.replyRate - first.replyRate, Math.max(first.replyRate, 0.0001)) : 0
    const bounceTrend = first ? rate(last.bounceRate - first.bounceRate, Math.max(first.bounceRate, 0.0001)) : 0

    const today = await queryOne<{ sent: string | number | null; replies: string | number | null; bounces: string | number | null }>(
      `
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'sent')::text AS sent,
        COUNT(*) FILTER (WHERE event_type = 'reply')::text AS replies,
        COUNT(*) FILTER (WHERE event_type = 'bounce')::text AS bounces
      FROM events
      WHERE client_id = $1
        AND created_at >= date_trunc('day', NOW())
      `,
      [clientId]
    )

    const todaySent = n(today?.sent)
    const todayReplies = n(today?.replies)
    const todayBounces = n(today?.bounces)
    const todayReplyRate = rate(todayReplies, todaySent)
    const todayBounceRate = rate(todayBounces, todaySent)

    const expectedRepliesToday = Math.round(todaySent * (avgReplyRate || 0))

    const bounceRisk = riskLabel(Math.max(todayBounceRate, avgBounceRate) * 100, 3, 5)

    const cap = await queryOne<{ cap: string | number | null }>(
      `
      SELECT COALESCE(SUM(COALESCE(daily_cap, daily_limit, 0)), 0)::text AS cap
      FROM domains
      WHERE client_id = $1
        AND status = 'active'
      `,
      [clientId]
    )

    const safeCap = n(cap?.cap)
    const safeRemaining = Math.max(0, safeCap - todaySent)

    const last3h = await queryOne<{ sent: string | number | null; bounces: string | number | null }>(
      `
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'sent')::text AS sent,
        COUNT(*) FILTER (WHERE event_type = 'bounce')::text AS bounces
      FROM events
      WHERE client_id = $1
        AND created_at > NOW() - INTERVAL '3 hours'
      `,
      [clientId]
    )

    const last3hSent = n(last3h?.sent)
    const last3hBounce = n(last3h?.bounces)
    const last3hBounceRate = rate(last3hBounce, last3hSent)

    const warnings: string[] = []
    if (last3hSent >= 25 && last3hBounceRate > Math.max(avgBounceRate * 1.5, 0.03)) {
      warnings.push('Bounce risk likely to increase in the next 2–3 hours. Sending will be adjusted automatically.')
    }
    if (safeRemaining <= Math.max(50, safeCap * 0.1) && safeCap > 0) {
      warnings.push('Domain fatigue expected soon. Consider adding a new domain or reducing send volume.')
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      forecast: {
        expectedRepliesToday,
        projectedBounceRisk: bounceRisk,
        estimatedSafeSendCapacityRemaining: safeRemaining,
      },
      trends: {
        days,
        reply: {
          direction: replyTrend >= 0 ? 'up' : 'down',
          changePct: replyTrend,
          text: trendText('reply', replyTrend, days),
        },
        bounce: {
          direction: bounceTrend <= 0 ? 'down' : 'up',
          changePct: bounceTrend,
          text: trendText('bounce', bounceTrend, days),
        },
      },
      earlyWarnings: warnings,
      baselines: {
        avgReplyRate,
        avgBounceRate,
      },
    })
  } catch (error) {
    console.error('[API] Executive forecast error', error)
    return NextResponse.json({ error: 'Failed to load executive forecast' }, { status: 500 })
  }
}

