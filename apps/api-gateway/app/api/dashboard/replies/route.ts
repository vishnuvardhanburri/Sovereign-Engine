import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

export async function GET() {
  // Minimal proof endpoint: recent replies + rollups.
  const total = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM events
     WHERE event_type = 'reply'`
  )

  const perCampaign = await query<{ campaign_id: number | null; count: string }>(
    `SELECT campaign_id, COUNT(*)::text AS count
     FROM events
     WHERE event_type = 'reply'
     GROUP BY campaign_id
     ORDER BY COUNT(*) DESC
     LIMIT 20`
  )

  const recent = await query<{
    id: number
    created_at: string
    campaign_id: number | null
    queue_job_id: number | null
    metadata: any
  }>(
    `SELECT id, created_at, campaign_id, queue_job_id, metadata
     FROM events
     WHERE event_type = 'reply'
     ORDER BY created_at DESC
     LIMIT 50`
  )

  return NextResponse.json({
    total_replies: Number(total.rows[0]?.count ?? 0),
    replies_per_campaign: perCampaign.rows.map((r) => ({
      campaign_id: r.campaign_id,
      count: Number(r.count ?? 0),
    })),
    recent: recent.rows.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      campaign_id: r.campaign_id,
      queue_job_id: r.queue_job_id,
      from_email: r.metadata?.from_email ?? null,
      to_email: r.metadata?.to_email ?? null,
      subject: r.metadata?.subject ?? null,
      body: r.metadata?.body ?? null,
      source: r.metadata?.source ?? null,
    })),
  })
}

