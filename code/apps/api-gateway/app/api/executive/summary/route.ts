import { NextRequest, NextResponse } from 'next/server'
import { resolveClientId } from '@/lib/client-context'
import { queryOne } from '@/lib/db'
import { isDemoModeEnabled, demoExecutiveSummaryPayload } from '@/lib/demo-mode'

type RateRow = {
  sent: string | number | null
  replies: string | number | null
  bounces: string | number | null
}

function rate(n: number, d: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return 0
  return n / d
}

export async function GET(request: NextRequest) {
  try {
    if (await isDemoModeEnabled()) {
      return NextResponse.json(await demoExecutiveSummaryPayload())
    }

    const clientId = await resolveClientId({
      searchParams: request.nextUrl.searchParams,
      headers: request.headers,
    })

    const today = await queryOne<RateRow>(
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

    const yesterday = await queryOne<RateRow>(
      `
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'sent')::text AS sent,
        COUNT(*) FILTER (WHERE event_type = 'reply')::text AS replies,
        COUNT(*) FILTER (WHERE event_type = 'bounce')::text AS bounces
      FROM events
      WHERE client_id = $1
        AND created_at >= date_trunc('day', NOW()) - INTERVAL '1 day'
        AND created_at < date_trunc('day', NOW())
      `,
      [clientId]
    )

    const interested = await queryOne<{ interested: string | number | null }>(
      `
      SELECT COUNT(*)::text AS interested
      FROM events
      WHERE client_id = $1
        AND event_type = 'reply'
        AND created_at >= date_trunc('day', NOW())
        AND COALESCE(metadata->>'reply_status','') = 'interested'
      `,
      [clientId]
    )

    const blocked = await queryOne<{ blocked: string | number | null }>(
      `
      SELECT COUNT(*)::text AS blocked
      FROM events
      WHERE client_id = $1
        AND event_type = 'skipped'
        AND created_at >= date_trunc('day', NOW())
        AND (
          COALESCE(metadata->>'reason','') ILIKE '%suppress%'
          OR COALESCE(metadata->>'reason','') ILIKE '%unsubscribe%'
          OR COALESCE(metadata->>'reason','') ILIKE '%compliance%'
        )
      `,
      [clientId]
    )

    const todaySent = Number(today?.sent ?? 0) || 0
    const todayReplies = Number(today?.replies ?? 0) || 0
    const todayBounces = Number(today?.bounces ?? 0) || 0

    const ySent = Number(yesterday?.sent ?? 0) || 0
    const yReplies = Number(yesterday?.replies ?? 0) || 0
    const yBounces = Number(yesterday?.bounces ?? 0) || 0

    const replyRateToday = rate(todayReplies, todaySent)
    const replyRateYesterday = rate(yReplies, ySent)
    const bounceRateToday = rate(todayBounces, todaySent)
    const bounceRateYesterday = rate(yBounces, ySent)

    const replyTrend = replyRateYesterday > 0 ? (replyRateToday - replyRateYesterday) / replyRateYesterday : 0
    const interestedToday = Number(interested?.interested ?? 0) || 0

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      today: {
        sent: todaySent,
        replies: todayReplies,
        interestedReplies: interestedToday,
        bounces: todayBounces,
        replyRate: replyRateToday,
        bounceRate: bounceRateToday,
      },
      yesterday: {
        sent: ySent,
        replies: yReplies,
        bounces: yBounces,
        replyRate: replyRateYesterday,
        bounceRate: bounceRateYesterday,
      },
      businessImpact: {
        estimatedConversationsToday: todayReplies,
        estimatedOpportunities: interestedToday,
        replyTrendPct: replyTrend,
      },
      safety: {
        complianceActive: true,
        blockedContactsToday: Number(blocked?.blocked ?? 0) || 0,
      },
    })
  } catch (error) {
    console.error('[API] Executive summary error', error)
    // Never 500 on demo paths: return a schema-compatible fallback.
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      today: {
        sent: 0,
        replies: 0,
        interestedReplies: 0,
        bounces: 0,
        replyRate: 0,
        bounceRate: 0,
      },
      yesterday: {
        sent: 0,
        replies: 0,
        bounces: 0,
        replyRate: 0,
        bounceRate: 0,
      },
      businessImpact: {
        estimatedConversationsToday: 0,
        estimatedOpportunities: 0,
        replyTrendPct: 0,
      },
      safety: {
        complianceActive: true,
        blockedContactsToday: 0,
      },
      error: 'Failed to load executive summary',
    })
  }
}
