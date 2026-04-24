import { NextRequest, NextResponse } from 'next/server'
import { resolveClientId } from '@/lib/client-context'
import { query } from '@/lib/db'

function pct(n: number) {
  return `${Math.round(n * 1000) / 10}%`
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const clientId = await resolveClientId({ headers: request.headers })
    const { id } = await ctx.params
    const campaignId = Number(id)
    if (!Number.isFinite(campaignId)) return NextResponse.json({ error: 'invalid_campaign_id' }, { status: 400 })

    const [campaign, jobs, actions, hours, ab] = await Promise.all([
      query<{ id: number; name: string }>(
        `SELECT id, name FROM campaigns WHERE client_id = $1 AND id = $2`,
        [clientId, campaignId]
      ),
      query<{ sent: string; deferred: string; dropped: string }>(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'completed')::text AS sent,
           COUNT(*) FILTER (WHERE status IN ('pending','retry'))::text AS deferred,
           COUNT(*) FILTER (WHERE status IN ('failed','skipped'))::text AS dropped
         FROM queue_jobs
         WHERE client_id = $1 AND campaign_id = $2`,
        [clientId, campaignId]
      ),
      query<{ created_at: string; summary: string }>(
        `SELECT created_at, summary
         FROM operator_actions
         WHERE client_id = $1 AND campaign_id = $2
         ORDER BY created_at DESC
         LIMIT 20`,
        [clientId, campaignId]
      ),
      query<{ hour: number; replies: string; sent: string }>(
        `SELECT
           EXTRACT(HOUR FROM created_at)::int AS hour,
           COUNT(*) FILTER (WHERE event_type = 'reply')::text AS replies,
           COUNT(*) FILTER (WHERE event_type = 'sent')::text AS sent
         FROM events
         WHERE client_id = $1 AND campaign_id = $2
           AND created_at > (CURRENT_TIMESTAMP - INTERVAL '7 days')
         GROUP BY 1
         ORDER BY 1`,
        [clientId, campaignId]
      ),
      query<{ outcome_group: string | null; sent: string; replies: string; bounces: string }>(
        `SELECT
           dal.outcome_group,
           COUNT(*) FILTER (WHERE e.event_type = 'sent')::text AS sent,
           COUNT(*) FILTER (WHERE e.event_type = 'reply')::text AS replies,
           COUNT(*) FILTER (WHERE e.event_type = 'bounce')::text AS bounces
         FROM decision_audit_logs dal
         LEFT JOIN events e
           ON e.client_id = dal.client_id
          AND e.queue_job_id = dal.queue_job_id
          AND e.event_type IN ('sent','reply','bounce')
         WHERE dal.client_id = $1
           AND dal.campaign_id = $2
         GROUP BY 1`,
        [clientId, campaignId]
      ),
    ])

    const name = campaign.rows[0]?.name ?? `Campaign ${campaignId}`
    const j = jobs.rows[0] ?? { sent: '0', deferred: '0', dropped: '0' }
    const sent = Number(j.sent ?? 0)
    const deferred = Number(j.deferred ?? 0)
    const dropped = Number(j.dropped ?? 0)

    // top hour by reply rate
    let bestHour: number | null = null
    let bestRate = 0
    for (const r of hours.rows) {
      const s = Number(r.sent ?? 0)
      const rep = Number(r.replies ?? 0)
      if (s >= 10) {
        const rr = rep / s
        if (rr > bestRate) {
          bestRate = rr
          bestHour = r.hour
        }
      }
    }

    const abRows = ab.rows
    const baseline = abRows.find((x) => x.outcome_group === 'baseline')
    const treatment = abRows.find((x) => x.outcome_group === 'treatment')
    const baselineReplyRate =
      baseline && Number(baseline.sent ?? 0) > 0 ? Number(baseline.replies ?? 0) / Number(baseline.sent ?? 0) : null
    const treatmentReplyRate =
      treatment && Number(treatment.sent ?? 0) > 0 ? Number(treatment.replies ?? 0) / Number(treatment.sent ?? 0) : null
    const lift =
      baselineReplyRate != null && treatmentReplyRate != null && baselineReplyRate > 0
        ? (treatmentReplyRate - baselineReplyRate) / baselineReplyRate
        : null

    const protectionActions = actions.rows.map((a) => `${new Date(a.created_at).toLocaleString()}: ${a.summary}`)

    const summary = [
      `${name}: ${sent} sent, ${deferred} deferred, ${dropped} dropped.`,
      bestHour != null ? `Top performing hour (7d): ${bestHour}:00 with reply rate ${pct(bestRate)}.` : `Top performing hour: insufficient data yet.`,
      lift != null ? `A/B reply lift: ${pct(lift)} (treatment ${pct(treatmentReplyRate!)} vs baseline ${pct(baselineReplyRate!)}).` : `A/B lift: insufficient data yet.`,
      protectionActions.length ? `Domain protection actions (last 20):` : `Domain protection actions: none recorded.`,
    ]

    return NextResponse.json({
      ok: true,
      campaignId,
      name,
      kpis: {
        sent,
        deferred,
        dropped,
        bestHour,
        bestHourReplyRate: bestHour != null ? bestRate : null,
        ab: {
          baseline: baseline ? { sent: Number(baseline.sent), replies: Number(baseline.replies), bounces: Number(baseline.bounces), replyRate: baselineReplyRate } : null,
          treatment: treatment ? { sent: Number(treatment.sent), replies: Number(treatment.replies), bounces: Number(treatment.bounces), replyRate: treatmentReplyRate } : null,
          lift,
        },
      },
      summary,
      protectionActions,
    })
  } catch (error) {
    console.error('[api/demo/campaign] failed', error)
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 })
  }
}

