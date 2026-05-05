import { query } from '@/lib/db'
import { appEnv } from '@/lib/env'

export type CampaignLiveStatus = {
  campaignId: number
  status: string
  contactCount: number
  sentCount: number
  replyCount: number
  bounceCount: number
  queuedPending: number
  queuedRetry: number
  queuedProcessing: number
  queuedCompleted: number
  queuedFailed: number
  replyRatePct: number
  bounceRatePct: number
  progressPct: number
  updatedAt: string
}

export async function getCampaignLiveStatus(input: { clientId?: number; campaignId: number }): Promise<CampaignLiveStatus | null> {
  const clientId = input.clientId ?? appEnv.defaultClientId()
  const campaignId = Number(input.campaignId)
  if (!campaignId) return null

  const campaignRes = await query<any>(
    `
    SELECT id, status, contact_count, sent_count, reply_count, bounce_count, updated_at
    FROM campaigns
    WHERE client_id = $1 AND id = $2
    LIMIT 1
  `,
    [clientId, campaignId],
  )

  const c = campaignRes.rows[0]
  if (!c) return null

  const q = await query<any>(
    `
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE status = 'retry')::int AS retry,
      COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
      COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
    FROM queue_jobs
    WHERE client_id = $1 AND campaign_id = $2
  `,
    [clientId, campaignId],
  )

  const pending = Number(q.rows[0]?.pending ?? 0) || 0
  const retry = Number(q.rows[0]?.retry ?? 0) || 0
  const processing = Number(q.rows[0]?.processing ?? 0) || 0
  const completed = Number(q.rows[0]?.completed ?? 0) || 0
  const failed = Number(q.rows[0]?.failed ?? 0) || 0

  const sent = Number(c.sent_count ?? 0) || 0
  const replies = Number(c.reply_count ?? 0) || 0
  const bounces = Number(c.bounce_count ?? 0) || 0
  const totalContacts = Number(c.contact_count ?? 0) || 0

  const replyRatePct = sent > 0 ? Number(((replies / sent) * 100).toFixed(2)) : 0
  const bounceRatePct = sent > 0 ? Number(((bounces / sent) * 100).toFixed(2)) : 0

  // Progress as a blend of queue completion + sent vs contact_count when available.
  const denom = Math.max(1, pending + retry + processing + completed + failed)
  const queueProgress = (completed + failed) / denom
  const sendProgress = totalContacts > 0 ? Math.min(1, sent / totalContacts) : queueProgress
  const progressPct = Number((Math.max(queueProgress, sendProgress) * 100).toFixed(0))

  return {
    campaignId: Number(c.id),
    status: String(c.status),
    contactCount: totalContacts,
    sentCount: sent,
    replyCount: replies,
    bounceCount: bounces,
    queuedPending: pending,
    queuedRetry: retry,
    queuedProcessing: processing,
    queuedCompleted: completed,
    queuedFailed: failed,
    replyRatePct,
    bounceRatePct,
    progressPct,
    updatedAt: new Date(c.updated_at).toISOString(),
  }
}

