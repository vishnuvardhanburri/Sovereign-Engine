import type { CampaignState, SystemMetrics } from '@/lib/services/metrics'
import type { DomainHealth } from '@/lib/agents/data/domain-health-agent'

export interface SelfHealingInput {
  error: unknown
  system_state: {
    metrics: SystemMetrics
    campaignState: CampaignState
  }
  domain: DomainHealth
}

export interface SelfHealingOutput {
  issue: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  action: 'retry' | 'delay' | 'reduce_volume' | 'pause' | 'reroute'
  recovery_plan: {
    retry_after_seconds: number
    volume_adjustment: number
    fallback_strategy: 'queue' | 'alternate_provider' | 'stop'
  }
  notify: boolean
  reason: string
}

const SELF_HEALING_PROMPT = `You are a system self-healing agent.
Detect failures and return recovery actions.

Rules:
- send failures spike → reduce volume
- API errors → retry with delay
- bounce spike → pause
- queue overload → slow system
- repeated failures → escalate

Return ONLY JSON.`

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.message}${error.stack ? ` | ${error.stack.split('\n')[0]}` : ''}`
  }

  return String(error)
}

function buildRecovery(input: SelfHealingInput): SelfHealingOutput {
  const message = normalizeError(input.error).toLowerCase()
  const bounceRisk = input.domain.bounceRate > 5 || input.domain.healthScore < 50
  const queueRisk = message.includes('queue') || message.includes('overload') || message.includes('retry')
  const apiError = message.includes('timeout') || message.includes('api') || message.includes('provider')
  const repeatedFailure = message.includes('failed') && message.includes('retry')
  const criticalDomain = input.domain.healthScore < 30 || input.system_state.metrics.bounceRate > 10

  if (bounceRisk) {
    return {
      issue: 'sustained deliverability risk',
      severity: criticalDomain ? 'critical' : 'high',
      action: 'pause',
      recovery_plan: {
        retry_after_seconds: 0,
        volume_adjustment: 0,
        fallback_strategy: 'stop',
      },
      notify: true,
      reason: 'Bounce rate and domain health indicate an immediate pause is required.',
    }
  }

  if (apiError) {
    return {
      issue: 'provider communication failure',
      severity: repeatedFailure ? 'high' : 'medium',
      action: 'retry',
      recovery_plan: {
        retry_after_seconds: repeatedFailure ? 600 : 120,
        volume_adjustment: 0,
        fallback_strategy: 'queue',
      },
      notify: repeatedFailure,
      reason: 'Transient API or provider errors should be retried after a short delay.',
    }
  }

  if (queueRisk) {
    return {
      issue: 'queue pressure detected',
      severity: 'medium',
      action: 'delay',
      recovery_plan: {
        retry_after_seconds: 300,
        volume_adjustment: 0,
        fallback_strategy: 'queue',
      },
      notify: false,
      reason: 'Queue overload indicates work should be delayed and drained safely.',
    }
  }

  if (criticalDomain) {
    return {
      issue: 'domain health degradation',
      severity: 'high',
      action: 'reduce_volume',
      recovery_plan: {
        retry_after_seconds: 0,
        volume_adjustment: Math.max(1, Math.round(input.system_state.metrics.sentCount * 0.1)),
        fallback_strategy: 'alternate_provider',
      },
      notify: true,
      reason: 'Domain health is low and send volume should be reduced immediately.',
    }
  }

  return {
    issue: 'unexpected failure',
    severity: repeatedFailure ? 'high' : 'low',
    action: apiError ? 'retry' : 'delay',
    recovery_plan: {
      retry_after_seconds: apiError ? 180 : 60,
      volume_adjustment: 0,
      fallback_strategy: apiError ? 'queue' : 'stop',
    },
    notify: repeatedFailure,
    reason: 'General failure recovery rules recommend retry or delay based on the error context.',
  }
}

export async function resolveSelfHealing(input: SelfHealingInput): Promise<SelfHealingOutput> {
  return buildRecovery(input)
}

export { SELF_HEALING_PROMPT }
