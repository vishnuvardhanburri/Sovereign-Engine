import type { CampaignState } from '@/lib/services/metrics'
import type { DomainHealth } from '@/lib/agents/data/domain-health-agent'
import type { SystemMetrics } from '@/lib/services/metrics'
import type { WarmupOutput } from '@/lib/agents/control/warmup-agent'

export interface BossDecision {
  decision: 'send' | 'pause' | 'reduce_volume' | 'increase_volume' | 'optimize_message' | 'follow_up'
  actions: string[]
  target_agents: string[]
  execution_plan: {
    volume: number
    timing: number
    sequence_step: 'step_1' | 'step_2' | 'step_3'
  }
  risk_level: 'low' | 'medium' | 'high'
  reason: string
}

const BOSS_PROMPT = `You are the central decision engine of an outbound system.
Your job is to decide actions, not generate content.

Protect domain health. Maximize replies.

Follow strict rules:
- bounce_rate > 5% → pause
- domain_health < 50 → reduce volume
- reply_rate < 2% → optimize message

Return ONLY JSON.`

export async function decideBossAction(input: {
  metrics: SystemMetrics
  domainHealth: DomainHealth
  campaignState: CampaignState
  warmup: WarmupOutput
}): Promise<BossDecision> {
  const { metrics, domainHealth, campaignState, warmup } = input
  const volumeBase = Math.max(1, Math.round(campaignState.dailyTarget * 0.1))
  const volumeScale = Math.max(1, Math.round(campaignState.dailyTarget * 0.2))

  const sendControlAgents = ['RateLimitAgent', 'ComplianceAgent']
  const outboundWorkers = ['SchedulerAgent', 'QueueAgent']
  const contentImprovementAgents = ['PersonalizationAgent', 'SubjectAgent', 'InsightAgent', 'ResearchAgent']

  let decision: BossDecision['decision'] = 'send'
  let reason = 'normal outbound cadence'
  let risk_level: BossDecision['risk_level'] = 'low'
  let target_agents: string[] = [...sendControlAgents, ...outboundWorkers]
  const actions: string[] = ['inspect_metrics', 'apply_plan']

  if (metrics.bounceRate > 5) {
    decision = 'pause'
    reason = 'bounce rate exceeded safe threshold'
    risk_level = 'high'
    target_agents = []
    actions.push('hold_sends')
  } else if (domainHealth.healthScore < 50) {
    decision = 'reduce_volume'
    reason = 'domain health is too low'
    risk_level = 'medium'
    actions.push('throttle_volume')
  } else if (metrics.replyRate < 2) {
    decision = 'optimize_message'
    reason = 'reply rate is underperforming'
    risk_level = 'medium'
    target_agents = contentImprovementAgents
    actions.push('refresh_content')
  } else if (metrics.positiveReplyRate > 25) {
    decision = 'increase_volume'
    reason = 'positive reply rate is strong'
    risk_level = 'low'
    actions.push('scale_volume')
  } else if (!warmup.safe) {
    decision = 'reduce_volume'
    reason = `warmup constraint: ${warmup.reason}`
    risk_level = 'medium'
    actions.push('enforce_warmup')
  } else if (campaignState.needsFollowUp) {
    decision = 'follow_up'
    reason = 'follow-up sequence is due'
    risk_level = 'low'
    target_agents = [...sendControlAgents, 'FollowUpAgent', ...outboundWorkers]
    actions.push('schedule_follow_up')
  }

  const sequence_step = campaignState.currentStep <= 1 ? 'step_1' : campaignState.currentStep === 2 ? 'step_2' : 'step_3'
  const rawVolume = decision === 'increase_volume'
    ? volumeBase + volumeScale
    : decision === 'reduce_volume'
    ? Math.max(1, volumeBase - volumeScale)
    : volumeBase
  const volume = Math.min(rawVolume, warmup.allowed_volume)
  const timing = decision === 'pause' ? 0 : campaignState.nextSendMinutes ?? 30

  return {
    decision,
    actions,
    target_agents,
    execution_plan: {
      volume,
      timing,
      sequence_step,
    },
    risk_level,
    reason,
  }
}

export { BOSS_PROMPT }
