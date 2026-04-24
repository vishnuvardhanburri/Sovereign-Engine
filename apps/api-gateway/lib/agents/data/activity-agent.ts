import { queryOne } from '@/lib/db'

export interface ActivitySignals {
  recentOpens: number
  recentReplies: number
  recentClicks: number
  activeConversations: number
}

export async function collectActivitySignals(clientId: number): Promise<ActivitySignals> {
  const row = await queryOne<{
    opens: string
    replies: string
    clicks: string
    conversations: string
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN event_type = 'opened' THEN 1 ELSE 0 END)::text, '0') AS opens,
       COALESCE(SUM(CASE WHEN event_type = 'reply' THEN 1 ELSE 0 END)::text, '0') AS replies,
       COALESCE(SUM(CASE WHEN event_type = 'clicked' THEN 1 ELSE 0 END)::text, '0') AS clicks,
       COALESCE(SUM(CASE WHEN event_type = 'reply' AND COALESCE(metadata->>'reply_status', '') IN ('interested', 'unread') THEN 1 ELSE 0 END)::text, '0') AS conversations
     FROM events
     WHERE client_id = $1
       AND created_at >= NOW() - INTERVAL '7 days'`,
    [clientId]
  )

  return {
    recentOpens: Number(row?.opens ?? '0'),
    recentReplies: Number(row?.replies ?? '0'),
    recentClicks: Number(row?.clicks ?? '0'),
    activeConversations: Number(row?.conversations ?? '0'),
  }
}
