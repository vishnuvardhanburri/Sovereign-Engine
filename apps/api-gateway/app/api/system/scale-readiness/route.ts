import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { resolveClientId } from '@/lib/client-context'

export async function GET(request: NextRequest) {
  try {
    const clientId = await resolveClientId({ headers: request.headers })

    const [events24h, pressure] = await Promise.all([
      query<{ sent: string; bounce: string; complaint: string }>(
        `SELECT
           COUNT(*) FILTER (WHERE event_type = 'sent')::text AS sent,
           COUNT(*) FILTER (WHERE event_type = 'bounce')::text AS bounce,
           COUNT(*) FILTER (WHERE event_type = 'complaint')::text AS complaint
         FROM events
         WHERE client_id = $1
           AND created_at > (CURRENT_TIMESTAMP - INTERVAL '24 hours')`,
        [clientId]
      ),
      query<{ ready: string; retry: string; avg_wait_ms: string }>(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'pending')::text AS ready,
           COUNT(*) FILTER (WHERE status = 'retry')::text AS retry,
           COALESCE(AVG(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - scheduled_at)) * 1000), 0)::text AS avg_wait_ms
         FROM queue_jobs
         WHERE client_id = $1 AND status IN ('pending','retry')`,
        [clientId]
      ),
    ])

    const e = events24h.rows[0] ?? { sent: '0', bounce: '0', complaint: '0' }
    const sent = Number(e.sent ?? 0)
    const bounce = Number(e.bounce ?? 0)
    const complaint = Number(e.complaint ?? 0)
    const bounceRate = sent > 0 ? bounce / sent : 0
    const complaintRate = sent > 0 ? complaint / sent : 0

    const p = pressure.rows[0] ?? { ready: '0', retry: '0', avg_wait_ms: '0' }
    const queueDepth = Number(p.ready ?? 0) + Number(p.retry ?? 0)
    const avgWaitMs = Number(p.avg_wait_ms ?? 0)

    const globalCap = Number(process.env.GLOBAL_SENDS_PER_MINUTE ?? 120)
    const shaperRatePerSec = Number(process.env.GLOBAL_SHAPER_RATE_PER_SEC ?? 2)
    const shaperBurst = Number(process.env.GLOBAL_SHAPER_BURST ?? 10)
    const maxPossiblePerMin = Math.min(globalCap, Math.floor(shaperRatePerSec * 60 + shaperBurst))

    let status: 'ready' | 'caution' | 'unsafe' = 'ready'
    let reason = 'healthy'
    let recommended_action: 'add domains' | 'increase ramp' | 'hold' = 'increase ramp'

    if (complaintRate > 0) {
      status = 'unsafe'
      reason = 'complaints_detected'
      recommended_action = 'hold'
    } else if (bounceRate > 0.08) {
      status = 'unsafe'
      reason = 'bounce_rate_high'
      recommended_action = 'hold'
    } else if (bounceRate > 0.05) {
      status = 'caution'
      reason = 'bounce_rate_elevated'
      recommended_action = 'hold'
    }

    if (queueDepth > 500 || avgWaitMs > 5 * 60_000) {
      status = status === 'unsafe' ? 'unsafe' : 'caution'
      reason = status === 'unsafe' ? reason : 'queue_pressure_high'
      recommended_action = 'add domains'
    }

    return NextResponse.json({
      ok: true,
      clientId,
      status,
      reason,
      recommended_action,
      inputs: {
        bounce_rate_24h: Number(bounceRate.toFixed(4)),
        complaint_rate_24h: Number(complaintRate.toFixed(4)),
        queue_depth: queueDepth,
        avg_wait_ms: Math.floor(avgWaitMs),
        max_possible_per_min: maxPossiblePerMin,
      },
    })
  } catch (err) {
    console.error('[api/system/scale-readiness] failed', err)
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 })
  }
}

