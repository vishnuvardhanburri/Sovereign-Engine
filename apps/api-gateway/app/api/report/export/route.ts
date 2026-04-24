import { NextRequest, NextResponse } from 'next/server'
import { resolveClientId } from '@/lib/client-context'
import { query } from '@/lib/db'

function toCsv(rows: Record<string, any>[]): string {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0]!)
  const escape = (v: any) => {
    const s = v == null ? '' : String(v)
    if (/[\",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`
    return s
  }
  return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n')
}

export async function GET(request: NextRequest) {
  try {
    const clientId = await resolveClientId({ headers: request.headers })
    const fmt = (request.nextUrl.searchParams.get('format') ?? 'csv').toLowerCase()
    const campaignIdRaw = request.nextUrl.searchParams.get('campaignId')
    const campaignId = campaignIdRaw ? Number(campaignIdRaw) : null

    const where = campaignId ? `AND dal.campaign_id = $2` : ``
    const params: any[] = campaignId ? [clientId, campaignId] : [clientId]

    const res = await query<any>(
      `SELECT
         dal.campaign_id,
         dal.queue_job_id,
         dal.trace_id,
         dal.idempotency_key,
         dal.decision,
         dal.outcome_group,
         dal.priority_score,
         dal.created_at AS decision_at,
         (dal.signals->>'expected_reply_prob')::numeric AS expected_reply_prob,
         (dal.signals->>'risk_adjustment')::numeric AS risk_adjustment,
         (dal.signals->>'domain_health')::numeric AS domain_health,
         -- outcomes
         COUNT(*) FILTER (WHERE e.event_type = 'sent')::int AS sent_events,
         COUNT(*) FILTER (WHERE e.event_type = 'reply')::int AS reply_events,
         COUNT(*) FILTER (WHERE e.event_type = 'bounce')::int AS bounce_events
       FROM decision_audit_logs dal
       LEFT JOIN events e
         ON e.client_id = dal.client_id
        AND e.queue_job_id = dal.queue_job_id
        AND e.event_type IN ('sent','reply','bounce')
       WHERE dal.client_id = $1
       ${where}
       GROUP BY 1,2,3,4,5,6,7,8,9,10,11,12`,
      params
    )

    if (fmt === 'json') {
      return NextResponse.json({ ok: true, rows: res.rows })
    }

    const csv = toCsv(res.rows)
    return new NextResponse(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="xavira-report-${campaignId ?? 'all'}.csv"`,
      },
    })
  } catch (error) {
    console.error('[api/report/export] failed', error)
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 })
  }
}

