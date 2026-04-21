import { query } from '@/lib/db'
import { emitEvent } from '@/lib/events'

export interface CampaignStrategyDecision {
  campaign_id: number
  action: 'keep' | 'switch_angle' | 'reduce_volume' | 'pause'
  reason: string
}

export async function evaluateCampaignStrategy(clientId: number, campaignId: number): Promise<CampaignStrategyDecision> {
  const row = await query<{
    sent: string
    replies: string
    bounces: string
    opens: string
    status: string
    angle: string | null
  }>(
    `
    SELECT
      c.status,
      c.angle,
      COALESCE(c.sent_count::text,'0') AS sent,
      COALESCE(c.reply_count::text,'0') AS replies,
      COALESCE(c.bounce_count::text,'0') AS bounces,
      COALESCE(c.open_count::text,'0') AS opens
    FROM campaigns c
    WHERE c.client_id = $1 AND c.id = $2
    LIMIT 1
    `,
    [clientId, campaignId]
  )

  const c = row.rows[0]
  if (!c) {
    return { campaign_id: campaignId, action: 'keep', reason: 'campaign not found' }
  }
  if (c.status !== 'active') {
    return { campaign_id: campaignId, action: 'keep', reason: `campaign ${c.status}` }
  }

  const sent = Number(c.sent) || 0
  const replies = Number(c.replies) || 0
  const bounces = Number(c.bounces) || 0
  const opens = Number(c.opens) || 0

  const replyRate = sent > 0 ? replies / sent : 0
  const bounceRate = sent > 0 ? bounces / sent : 0
  const openRate = sent > 0 ? opens / sent : 0

  if (bounceRate > 0.06 && sent > 100) {
    return { campaign_id: campaignId, action: 'pause', reason: `bounce_rate=${bounceRate.toFixed(3)}` }
  }

  if (sent > 400 && replyRate < 0.003 && openRate < 0.12) {
    return { campaign_id: campaignId, action: 'switch_angle', reason: `low_perf reply=${replyRate.toFixed(4)} open=${openRate.toFixed(3)}` }
  }

  if (sent > 200 && replyRate < 0.002) {
    return { campaign_id: campaignId, action: 'reduce_volume', reason: `reply_rate=${replyRate.toFixed(4)}` }
  }

  return { campaign_id: campaignId, action: 'keep', reason: `ok reply=${replyRate.toFixed(4)} open=${openRate.toFixed(3)} bounce=${bounceRate.toFixed(3)}` }
}

export async function applyCampaignStrategy(clientId: number, decision: CampaignStrategyDecision): Promise<void> {
  if (decision.action === 'switch_angle') {
    // Deterministic angle rotation.
    const next = await query<{ angle: string | null }>(
      `SELECT angle FROM campaigns WHERE client_id = $1 AND id = $2 LIMIT 1`,
      [clientId, decision.campaign_id]
    )
    const current = String(next.rows[0]?.angle ?? 'pattern')
    const rotated = current === 'pattern' ? 'pain' : current === 'pain' ? 'authority' : 'pattern'
    await query(
      `UPDATE campaigns SET angle = $3, updated_at = CURRENT_TIMESTAMP WHERE client_id = $1 AND id = $2`,
      [clientId, decision.campaign_id, rotated]
    )
  } else if (decision.action === 'pause') {
    await query(
      `UPDATE campaigns SET status = 'paused', updated_at = CURRENT_TIMESTAMP WHERE client_id = $1 AND id = $2`,
      [clientId, decision.campaign_id]
    )
  }

  await emitEvent({
    event_type: 'CAMPAIGN_STRATEGY',
    source_agent: 'campaign_strategy',
    payload: decision as unknown as Record<string, unknown>,
  })
}

