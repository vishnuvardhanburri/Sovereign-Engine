import { collectCampaignMetrics } from '@/lib/agents/data/metrics-agent'
import { evaluateDomainHealth } from '@/lib/agents/data/domain-health-agent'
import { scoreLeadQuality } from '@/lib/agents/data/lead-quality-agent'
import { collectActivitySignals } from '@/lib/agents/data/activity-agent'
import { detectRisk } from '@/lib/agents/data/risk-agent'
import { selectOutboundLeads } from '@/lib/agents/data/lead-selection-agent'
import { queryOne } from '@/lib/db'

export interface CampaignState {
  campaignId: number | null
  status: 'active' | 'paused' | 'completed' | 'draft'
  dailyTarget: number
  currentStep: 1 | 2 | 3
  needsFollowUp: boolean
  nextSendMinutes: number
}

export interface SystemMetrics {
  sentCount: number
  replyCount: number
  bounceCount: number
  openCount: number
  bounceRate: number
  replyRate: number
  positiveReplyRate: number
  activeCampaigns: number
}

export interface SystemHealthPacket {
  metrics: SystemMetrics
  domainHealth: Awaited<ReturnType<typeof evaluateDomainHealth>>
  campaignState: CampaignState
  leads: Awaited<ReturnType<typeof scoreLeadQuality>>
  outboundLeads: Awaited<ReturnType<typeof selectOutboundLeads>>
  activity: Awaited<ReturnType<typeof collectActivitySignals>>
  risk: Awaited<ReturnType<typeof detectRisk>>
}

export async function collectSystemMetrics(clientId: number): Promise<SystemHealthPacket> {
  const [metrics, domainHealth, leads, outboundLeads, activity, risk, campaignState] = await Promise.all([
    collectCampaignMetrics(clientId),
    evaluateDomainHealth(clientId),
    scoreLeadQuality(clientId),
    selectOutboundLeads(clientId, 100),
    collectActivitySignals(clientId),
    detectRisk(clientId),
    collectCampaignState(clientId),
  ])

  return {
    metrics,
    domainHealth,
    campaignState,
    leads,
    outboundLeads,
    activity,
    risk,
  }
}

async function collectCampaignState(clientId: number): Promise<CampaignState> {
  const record = await queryOne<{
    id: number
    status: string
    daily_target: number | null
    active_lead_count: number | null
    last_enqueued_at: string | null
  }>(
    `SELECT id, status, daily_target, active_lead_count, last_enqueued_at
     FROM campaigns
     WHERE client_id = $1
     ORDER BY active_lead_count DESC NULLS LAST
     LIMIT 1`,
    [clientId]
  )

  if (!record) {
    return {
      campaignId: null,
      status: 'draft',
      dailyTarget: 10,
      currentStep: 1,
      needsFollowUp: false,
      nextSendMinutes: 30,
    }
  }

  return {
    campaignId: Number(record.id),
    status: record.status as CampaignState['status'],
    dailyTarget: record.daily_target ?? 10,
    currentStep: record.active_lead_count && record.active_lead_count > 50 ? 2 : 1,
    needsFollowUp: Boolean(record.last_enqueued_at),
    nextSendMinutes: 30,
  }
}
