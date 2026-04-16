import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, transaction } from '@/lib/db'
import { Domain, Event } from '@/lib/db/types'

interface HealthMetrics {
  total_sent: number
  total_bounces: number
  total_replies: number
  bounce_rate: number
  reply_rate: number
}

async function calculateHealthScore(domain_id: number): Promise<HealthMetrics> {
  // Get event counts from last 7 days
  const results = await query<any>(
    `SELECT 
      type,
      COUNT(*) as count
    FROM events e
    WHERE e.identity_id IN (SELECT id FROM identities WHERE domain_id = $1)
    AND e.created_at > NOW() - INTERVAL '7 days'
    GROUP BY type`,
    [domain_id]
  )

  const events = results.rows.reduce((acc: any, row: any) => {
    acc[row.type] = parseInt(row.count)
    return acc
  }, {})

  const total_sent = events.sent || 0
  const total_bounces = events.bounce || 0
  const total_replies = events.reply || 0

  return {
    total_sent,
    total_bounces,
    total_replies,
    bounce_rate: total_sent > 0 ? (total_bounces / total_sent) * 100 : 0,
    reply_rate: total_sent > 0 ? (total_replies / total_sent) * 100 : 0,
  }
}

function calculateNewHealthScore(metrics: HealthMetrics, currentScore: number): number {
  // Health scoring logic
  // Start with current score
  let score = currentScore

  // Bounce rate penalty (max 30 points)
  if (metrics.bounce_rate > 5) {
    score -= Math.min(30, metrics.bounce_rate * 2)
  } else if (metrics.bounce_rate < 2) {
    score += 5 // Reward low bounce rates
  }

  // Reply rate bonus (max 20 points)
  if (metrics.reply_rate > 10) {
    score += Math.min(20, metrics.reply_rate * 1.5)
  } else if (metrics.reply_rate < 2) {
    score -= 10 // Penalty for low engagement
  }

  // Clamp score between 0 and 100
  return Math.max(0, Math.min(100, score))
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { domain_id } = body

    if (!domain_id) {
      return NextResponse.json(
        { error: 'domain_id required' },
        { status: 400 }
      )
    }

    const domain = await queryOne<Domain>(
      'SELECT * FROM domains WHERE id = $1',
      [domain_id]
    )

    if (!domain) {
      return NextResponse.json(
        { error: 'Domain not found' },
        { status: 404 }
      )
    }

    // Calculate health metrics
    const metrics = await calculateHealthScore(domain_id)
    const newScore = calculateNewHealthScore(metrics, domain.health_score)

    // Update domain with new health score
    // If bounce rate > 5%, pause the domain
    const newStatus =
      metrics.bounce_rate > 5 && domain.status === 'active'
        ? 'paused'
        : domain.status

    const updated = await queryOne<Domain>(
      `UPDATE domains 
       SET health_score = $1,
           bounce_rate = $2,
           reply_rate = $3,
           status = $4,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING *`,
      [newScore, metrics.bounce_rate, metrics.reply_rate, newStatus, domain_id]
    )

    return NextResponse.json({
      domain: updated,
      metrics,
      paused_due_to_bounces: metrics.bounce_rate > 5,
    })
  } catch (error) {
    console.error('[API] Error calculating health:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const domain_id = searchParams.get('domain_id')

    if (!domain_id) {
      // Get stats for all domains
      const results = await query<any>(
        `SELECT 
          d.id,
          d.domain,
          COUNT(DISTINCT CASE WHEN e.type = 'sent' THEN e.id END) as total_sent,
          COUNT(DISTINCT CASE WHEN e.type = 'bounce' THEN e.id END) as total_bounces,
          COUNT(DISTINCT CASE WHEN e.type = 'reply' THEN e.id END) as total_replies,
          d.health_score,
          d.bounce_rate,
          d.reply_rate
        FROM domains d
        LEFT JOIN identities i ON d.id = i.domain_id
        LEFT JOIN events e ON i.id = e.identity_id
        GROUP BY d.id
        ORDER BY d.created_at DESC`
      )

      return NextResponse.json(results.rows)
    }

    // Get stats for specific domain
    const metrics = await calculateHealthScore(parseInt(domain_id))
    return NextResponse.json(metrics)
  } catch (error) {
    console.error('[API] Error fetching health stats:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
