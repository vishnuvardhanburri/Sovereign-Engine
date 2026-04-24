import type { SystemMetrics } from '@/lib/services/metrics'
import type { DomainHealth } from '@/lib/agents/data/domain-health-agent'

export interface ImprovementInsight {
  suggestion: string
  priority: 'low' | 'medium' | 'high'
}

export async function suggestCampaignImprovements(input: {
  metrics: SystemMetrics
  domainHealth: DomainHealth
}): Promise<ImprovementInsight> {
  if (input.metrics.replyRate < 2) {
    return {
      suggestion: 'Test a new subject line and stronger personalization hooks to spark replies.',
      priority: 'high',
    }
  }

  if (input.domainHealth.healthScore < 60) {
    return {
      suggestion: 'Reduce send volume and focus on the healthiest domains before scaling.',
      priority: 'high',
    }
  }

  return {
    suggestion: 'The campaign is stable. Keep the current angle and validate a small scale increase.',
    priority: 'low',
  }
}
