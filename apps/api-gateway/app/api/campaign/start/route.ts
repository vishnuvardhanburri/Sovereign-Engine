import { NextRequest, NextResponse } from 'next/server'
import { enqueueCampaignJobs, getCampaign } from '@/lib/backend'
import { resolveClientId } from '@/lib/client-context'
import { query } from '@/lib/db'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const clientId = await resolveClientId({
      body,
      headers: request.headers,
    })

    if (!body.campaign_id) {
      return NextResponse.json(
        { error: 'campaign_id is required' },
        { status: 400 }
      )
    }

    const campaignId = Number(body.campaign_id)
    const campaign = await getCampaign(clientId, campaignId)
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    // Onboarding safety gate: block campaign start if core deliverability setup is unsafe.
    const [domains, identities] = await Promise.all([
      query<{ total: string; active: string; unsafe_auth: string; warmup_low: string }>(
        `SELECT
           COUNT(*)::text AS total,
           COUNT(*) FILTER (WHERE status = 'active')::text AS active,
           COUNT(*) FILTER (WHERE status = 'active' AND (spf_valid = FALSE OR dkim_valid = FALSE OR dmarc_valid = FALSE))::text AS unsafe_auth,
           COUNT(*) FILTER (WHERE status = 'active' AND warmup_stage < 1)::text AS warmup_low
         FROM domains
         WHERE client_id = $1`,
        [clientId]
      ),
      query<{ active: string }>(
        `SELECT COUNT(*)::text AS active
         FROM identities
         WHERE client_id = $1 AND status = 'active'`,
        [clientId]
      ),
    ])

    const blockers: string[] = []
    const d = domains.rows[0] ?? { total: '0', active: '0', unsafe_auth: '0', warmup_low: '0' }
    if (Number(d.active ?? 0) === 0) blockers.push('no_active_domains')
    if (Number(identities.rows[0]?.active ?? 0) === 0) blockers.push('no_active_inboxes')
    if (Number(d.unsafe_auth ?? 0) > 0) blockers.push('spf_dkim_dmarc_not_verified')
    if (Number(d.warmup_low ?? 0) > 0) blockers.push('domain_warmup_not_ready')

    if (blockers.length) {
      return NextResponse.json(
        {
          error: 'onboarding_check_failed',
          message: 'Campaign start blocked until domain/inbox setup is safe.',
          blockers,
        },
        { status: 409 }
      )
    }

    const result = await enqueueCampaignJobs(
      clientId,
      campaignId,
      Array.isArray(body.contact_ids)
        ? body.contact_ids.map((value: unknown) => Number(value)).filter(Boolean)
        : undefined
    )

    return NextResponse.json({
      campaign_id: campaignId,
      queued_jobs: result.jobs.length,
      contact_count: result.contactCount,
    })
  } catch (error) {
    console.error('[API] Failed to start campaign', error)
    return NextResponse.json({ error: 'Failed to start campaign' }, { status: 500 })
  }
}
