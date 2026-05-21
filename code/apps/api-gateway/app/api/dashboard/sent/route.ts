import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { resolveClientId } from '@/lib/client-context'

export async function GET(request: NextRequest) {
  try {
    const clientId = await resolveClientId({ headers: request.headers })
    const limit = Math.max(1, Math.min(Number(request.nextUrl.searchParams.get('limit') ?? 100), 500))

    const [eventsRes, statsRes] = await Promise.all([
      // Main event feed
      query<{
        id: number
        event_type: string
        created_at: string
        campaign_id: number | null
        campaign_name: string | null
        queue_job_id: number | null
        provider_message_id: string | null
        to_email: string | null
        from_email: string | null
        subject: string | null
        error: string | null
        body_text: string | null
        body_html: string | null
        provider: string | null
        offer_type: string | null
      }>(
        `SELECT
           e.id,
           e.event_type,
           e.created_at::text AS created_at,
           e.campaign_id,
           c.name AS campaign_name,
           e.queue_job_id,
           e.provider_message_id,
           COALESCE(NULLIF(e.metadata->>'to_email',''), NULLIF(e.metadata->>'to',''), NULLIF(e.metadata->>'recipient',''), co.email) AS to_email,
           COALESCE(NULLIF(e.metadata->>'from_email',''), NULLIF(e.metadata->>'from',''), i.email) AS from_email,
           COALESCE(NULLIF(e.metadata->>'subject',''), NULLIF(e.metadata->>'email_subject','')) AS subject,
           COALESCE(NULLIF(e.metadata->>'error',''), NULLIF(e.metadata->>'reason','')) AS error,
           e.metadata->>'body_text' AS body_text,
           e.metadata->>'body_html' AS body_html,
           COALESCE(NULLIF(e.metadata->>'provider',''), NULLIF(e.metadata->>'sending_provider','')) AS provider,
           COALESCE(NULLIF(co.custom_fields->>'offer_type',''), NULLIF(e.metadata->>'offer_type','')) AS offer_type
         FROM events e
         LEFT JOIN campaigns c ON c.id = e.campaign_id AND c.client_id = e.client_id
         LEFT JOIN contacts co ON co.id = e.contact_id AND co.client_id = e.client_id
         LEFT JOIN identities i ON i.id = e.identity_id AND i.client_id = e.client_id
         WHERE e.client_id = $1
           AND e.event_type IN ('sent','failed','bounce')
         ORDER BY e.created_at DESC
         LIMIT $2`,
        [clientId, limit]
      ),

      // Summary stats: sent/failed/bounce + reply counts + follow-up + provider breakdown
      query<{
        sent_today: string
        sent_24h: string
        failed_24h: string
        bounced_24h: string
        replies_24h: string
        sent_7d: string
        replies_7d: string
        agency_sent_24h: string
        direct_sent_24h: string
        top_failure_reason: string | null
        top_provider: string | null
      }>(
        `SELECT
           COUNT(*) FILTER (WHERE event_type = 'sent' AND created_at >= CURRENT_DATE)::text AS sent_today,
           COUNT(*) FILTER (WHERE event_type = 'sent' AND created_at >= NOW() - INTERVAL '24h')::text AS sent_24h,
           COUNT(*) FILTER (WHERE event_type = 'failed' AND created_at >= NOW() - INTERVAL '24h')::text AS failed_24h,
           COUNT(*) FILTER (WHERE event_type = 'bounce' AND created_at >= NOW() - INTERVAL '24h')::text AS bounced_24h,
           COUNT(*) FILTER (WHERE event_type = 'reply' AND created_at >= NOW() - INTERVAL '24h')::text AS replies_24h,
           COUNT(*) FILTER (WHERE event_type = 'sent' AND created_at >= NOW() - INTERVAL '7 days')::text AS sent_7d,
           COUNT(*) FILTER (WHERE event_type = 'reply' AND created_at >= NOW() - INTERVAL '7 days')::text AS replies_7d,
           COUNT(*) FILTER (
             WHERE event_type = 'sent'
               AND created_at >= NOW() - INTERVAL '24h'
               AND COALESCE(metadata->>'offer_type','') = 'agency'
           )::text AS agency_sent_24h,
           COUNT(*) FILTER (
             WHERE event_type = 'sent'
               AND created_at >= NOW() - INTERVAL '24h'
               AND COALESCE(metadata->>'offer_type','direct') <> 'agency'
           )::text AS direct_sent_24h,
           (
             SELECT COALESCE(NULLIF(metadata->>'error',''), NULLIF(metadata->>'reason',''))
             FROM events e2
             WHERE e2.client_id = $1
               AND e2.event_type IN ('failed','bounce')
               AND e2.created_at >= NOW() - INTERVAL '24h'
               AND COALESCE(NULLIF(e2.metadata->>'error',''), NULLIF(e2.metadata->>'reason','')) IS NOT NULL
             GROUP BY 1
             ORDER BY COUNT(*) DESC
             LIMIT 1
           ) AS top_failure_reason,
           (
             SELECT COALESCE(NULLIF(metadata->>'provider',''), NULLIF(metadata->>'sending_provider',''))
             FROM events e3
             WHERE e3.client_id = $1
               AND e3.event_type = 'sent'
               AND e3.created_at >= NOW() - INTERVAL '24h'
               AND COALESCE(NULLIF(e3.metadata->>'provider',''), NULLIF(e3.metadata->>'sending_provider','')) IS NOT NULL
             GROUP BY 1
             ORDER BY COUNT(*) DESC
             LIMIT 1
           ) AS top_provider
         FROM events
         WHERE client_id = $1
           AND created_at >= NOW() - INTERVAL '7 days'`,
        [clientId]
      ),
    ])

    const s = statsRes.rows[0]
    const sent24h = Number(s?.sent_24h ?? 0)
    const replies24h = Number(s?.replies_24h ?? 0)
    const sent7d = Number(s?.sent_7d ?? 0)
    const replies7d = Number(s?.replies_7d ?? 0)

    const summary = {
      sentToday: Number(s?.sent_today ?? 0),
      sent24h,
      failed24h: Number(s?.failed_24h ?? 0),
      bounced24h: Number(s?.bounced_24h ?? 0),
      replies24h,
      replyRate24h: sent24h > 0 ? Math.round((replies24h / sent24h) * 1000) / 10 : 0,
      sent7d,
      replies7d,
      replyRate7d: sent7d > 0 ? Math.round((replies7d / sent7d) * 1000) / 10 : 0,
      agencySent24h: Number(s?.agency_sent_24h ?? 0),
      directSent24h: Number(s?.direct_sent_24h ?? 0),
      topFailureReason: s?.top_failure_reason ?? null,
      topProvider: s?.top_provider ?? null,
    }

    return NextResponse.json({
      ok: true,
      summary,
      items: eventsRes.rows.map((r) => ({
        id: Number(r.id),
        type: r.event_type,
        createdAt: r.created_at,
        campaignId: r.campaign_id ? Number(r.campaign_id) : null,
        campaignName: r.campaign_name ?? null,
        queueJobId: r.queue_job_id ? Number(r.queue_job_id) : null,
        providerMessageId: r.provider_message_id ?? null,
        toEmail: r.to_email ?? '',
        fromEmail: r.from_email ?? '',
        subject: r.subject ?? '',
        error: r.error ?? null,
        bodyText: r.body_text ?? '',
        bodyHtml: r.body_html ?? '',
        provider: r.provider ?? null,
        offerType: r.offer_type ?? null,
      })),
    })
  } catch (error) {
    console.error('[api/dashboard/sent] failed', error)
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const clientId = await resolveClientId({ headers: request.headers })
    const kind = String(request.nextUrl.searchParams.get('kind') ?? 'failed').trim().toLowerCase()

    if (kind === 'failed') {
      await query(
        `DELETE FROM events
         WHERE client_id = $1
           AND event_type IN ('failed','bounce')`,
        [clientId]
      )
      return NextResponse.json({ ok: true })
    }

    if (kind === 'test') {
      // Clear test runs based on the stable subject prefix used by send:test.
      await query(
        `DELETE FROM events
         WHERE client_id = $1
           AND event_type IN ('sent','failed','bounce')
           AND COALESCE(metadata->>'subject','') LIKE '[Sovereign Engine Test]%'`,
        [clientId]
      )
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ ok: false, error: 'invalid_kind' }, { status: 400 })
  } catch (error) {
    console.error('[api/dashboard/sent] delete failed', error)
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 })
  }
}
