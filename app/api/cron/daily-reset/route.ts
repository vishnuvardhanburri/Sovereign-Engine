import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { resetDailyCounts, scaleDomainLimits } from '@/lib/rate-limiter'
import { Domain } from '@/lib/db/types'

/**
 * Daily reset job
 * 
 * Should be called once per day (via cron service like Vercel Cron, EasyCron, etc)
 * 
 * Actions:
 * 1. Reset sent_today counters for all identities and domains
 * 2. Recalculate health scores based on bounce/reply rates
 * 3. Pause domains with bounce rate > 5%
 * 4. Scale limits based on health (up to 50-500 range)
 * 5. Clear Redis counters
 */
export async function POST(req: NextRequest) {
  // Verify request is from authorized cron service
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    console.log('[Cron] Starting daily reset job')

    // 1. Reset counters
    await resetDailyCounts()

    // 2. Recalculate health scores
    const domains = await query<Domain>('SELECT * FROM domains')
    const now = new Date().toISOString()

    for (const domain of domains.rows) {
      // Get bounce/reply rates from past 7 days
      const stats = await queryOne<any>(
        `SELECT
          COUNT(CASE WHEN type = 'sent' THEN 1 END) as total_sent,
          COUNT(CASE WHEN type = 'bounce' THEN 1 END) as total_bounces,
          COUNT(CASE WHEN type = 'reply' THEN 1 END) as total_replies
        FROM events e
        WHERE e.identity_id IN (SELECT id FROM identities WHERE domain_id = $1)
        AND e.created_at > NOW() - INTERVAL '7 days'`,
        [domain.id]
      )

      const totalSent = parseInt(stats?.total_sent || '0')
      const totalBounces = parseInt(stats?.total_bounces || '0')
      const totalReplies = parseInt(stats?.total_replies || '0')

      const bounceRate = totalSent > 0 ? (totalBounces / totalSent) * 100 : 0
      const replyRate = totalSent > 0 ? (totalReplies / totalSent) * 100 : 0

      // Calculate new health score
      let healthScore = 100
      if (bounceRate > 5) {
        healthScore -= Math.min(40, bounceRate * 2)
      }
      if (replyRate > 10) {
        healthScore += Math.min(20, replyRate * 1.5)
      } else if (replyRate < 2) {
        healthScore -= 10
      }
      healthScore = Math.max(0, Math.min(100, healthScore))

      // Pause if bounce rate too high
      let newStatus = domain.status
      if (bounceRate > 5 && domain.status === 'active') {
        newStatus = 'paused'
        console.log(
          `[Cron] Pausing domain ${domain.domain} due to ${bounceRate.toFixed(1)}% bounce rate`
        )
      }

      // Update domain
      await query(
        `UPDATE domains 
         SET health_score = $1, bounce_rate = $2, reply_rate = $3, status = $4, last_reset_at = $5
         WHERE id = $6`,
        [healthScore, bounceRate, replyRate, newStatus, now, domain.id]
      )
    }

    // 3. Scale limits based on health
    await scaleDomainLimits()

    // 4. Clear Redis daily counters
    const domainIds = domains.rows.map((d: Domain) => d.id)
    for (const domainId of domainIds) {
      // Note: Redis counters with TTL will expire automatically
      // But we can explicitly clear them if needed
      // await redis.del(`sent:domain:${domainId}`)
    }

    console.log('[Cron] Daily reset job completed')

    return NextResponse.json({
      success: true,
      message: 'Daily reset completed',
      timestamp: now,
      domains_processed: domains.rowCount,
    })
  } catch (error) {
    console.error('[Cron] Error in daily reset job:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  return NextResponse.json({
    message: 'Daily reset endpoint - POST with authorization header',
    environment: {
      has_cron_secret: !!process.env.CRON_SECRET,
    },
  })
}
