import { NextRequest, NextResponse } from 'next/server'
import { appEnv } from '@/lib/env'
import { query } from '@/lib/db'
import { createAlert, recordMetric } from '@/lib/production-fixes'

// Daily reconciliation:
// - scan last 24h completed sends
// - ensure each has a SENT event
// - ensure each has an audit log
// - flag anomalies (no destructive repair beyond alerting/metrics)
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${appEnv.cronSecret()}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const windowHours = Number(request.nextUrl.searchParams.get('hours') ?? 24) || 24

    const candidates = await query<{
      client_id: number
      id: number
      campaign_id: number
      recipient_email: string | null
      idempotency_key: string | null
      completed_at: string | null
      provider_message_id: string | null
    }>(
      `SELECT
         client_id,
         id,
         campaign_id,
         recipient_email,
         idempotency_key,
         completed_at,
         provider_message_id
       FROM queue_jobs
       WHERE status = 'completed'
         AND completed_at > (CURRENT_TIMESTAMP - ($1::int || ' hours')::interval)`,
      [windowHours]
    )

    let missingSent = 0
    let missingAudit = 0

    for (const row of candidates.rows) {
      const sent = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM events
         WHERE client_id = $1
           AND queue_job_id = $2
           AND event_type = 'sent'`,
        [row.client_id, row.id]
      )
      if (Number(sent.rows[0]?.count ?? 0) === 0) {
        missingSent += 1
        await createAlert(
          row.client_id,
          'reconcile_missing_sent_event',
          'high',
          `Queue job ${row.id} marked completed but has no SENT event (campaign ${row.campaign_id}).`
        )
        await recordMetric(row.client_id, 'reconcile_missing_sent_event', 1, { queueJobId: row.id, campaignId: row.campaign_id })
      }

      const audit = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM decision_audit_logs
         WHERE client_id = $1
           AND queue_job_id = $2`,
        [row.client_id, row.id]
      )
      if (Number(audit.rows[0]?.count ?? 0) === 0) {
        missingAudit += 1
        await createAlert(
          row.client_id,
          'reconcile_missing_audit_log',
          'medium',
          `Queue job ${row.id} has no decision audit log (campaign ${row.campaign_id}).`
        )
        await recordMetric(row.client_id, 'reconcile_missing_audit_log', 1, { queueJobId: row.id, campaignId: row.campaign_id })
      }
    }

    return NextResponse.json({
      ok: true,
      windowHours,
      scanned: candidates.rowCount,
      anomalies: {
        missingSent,
        missingAudit,
      },
    })
  } catch (error) {
    console.error('[cron/reconcile] failed', error)
    return NextResponse.json({ error: 'Failed to reconcile' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'reconcile' })
}

