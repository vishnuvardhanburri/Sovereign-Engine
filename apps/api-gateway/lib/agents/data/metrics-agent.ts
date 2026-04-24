import { queryOne } from '@/lib/db'

export interface CampaignMetrics {
  sentCount: number
  replyCount: number
  bounceCount: number
  openCount: number
  bounceRate: number
  replyRate: number
  positiveReplyRate: number
  activeCampaigns: number
}

export async function collectCampaignMetrics(clientId: number): Promise<CampaignMetrics> {
  const campaignTotals = await queryOne<{
    sent_count: string
    reply_count: string
    bounce_count: string
    open_count: string
    active_campaigns: string
  }>(
    `SELECT
       COALESCE(SUM(sent_count)::text, '0') AS sent_count,
       COALESCE(SUM(reply_count)::text, '0') AS reply_count,
       COALESCE(SUM(bounce_count)::text, '0') AS bounce_count,
       COALESCE(SUM(open_count)::text, '0') AS open_count,
       COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END)::text, '0') AS active_campaigns
     FROM campaigns
     WHERE client_id = $1`,
    [clientId]
  )

  const replyTotals = await queryOne<{
    positive_replies: string
    total_replies: string
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN event_type = 'reply' AND COALESCE(metadata->>'reply_status', '') = 'interested' THEN 1 ELSE 0 END)::text, '0') AS positive_replies,
       COALESCE(SUM(CASE WHEN event_type = 'reply' THEN 1 ELSE 0 END)::text, '0') AS total_replies
     FROM events
     WHERE client_id = $1`,
    [clientId]
  )

  const sentCount = Number(campaignTotals?.sent_count ?? '0')
  const replyCount = Number(campaignTotals?.reply_count ?? '0')
  const bounceCount = Number(campaignTotals?.bounce_count ?? '0')
  const openCount = Number(campaignTotals?.open_count ?? '0')
  const positiveReplies = Number(replyTotals?.positive_replies ?? '0')
  const totalReplies = Number(replyTotals?.total_replies ?? '0')

  const bounceRate = sentCount > 0 ? Number(((bounceCount / sentCount) * 100).toFixed(2)) : 0
  const replyRate = sentCount > 0 ? Number(((replyCount / sentCount) * 100).toFixed(2)) : 0
  const positiveReplyRate = totalReplies > 0 ? Number(((positiveReplies / totalReplies) * 100).toFixed(2)) : 0

  return {
    sentCount,
    replyCount,
    bounceCount,
    openCount,
    bounceRate,
    replyRate,
    positiveReplyRate,
    activeCampaigns: Number(campaignTotals?.active_campaigns ?? '0'),
  }
}
