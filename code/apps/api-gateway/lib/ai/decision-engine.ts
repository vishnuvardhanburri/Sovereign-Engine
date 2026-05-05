import type { CopilotSystemContext } from '@/lib/ai/system-context'

export type CopilotIssueType =
  | 'LOW_REPLY_RATE'
  | 'HIGH_BOUNCE_RATE'
  | 'DOMAIN_FATIGUE'
  | 'QUEUE_BACKLOG'
  | 'SETUP_REQUIRED'

export interface CopilotDiagnosis {
  issue: string
  type: CopilotIssueType
  cause: string
  evidence: string[]
  recommendedActions: Array<{
    title: string
    detail: string
    tool: string
    args: Record<string, unknown>
    requiresApproval: true
  }>
  confidence: number // 0..1 deterministic heuristic
}

export interface CopilotDecisionOutput {
  diagnoses: CopilotDiagnosis[]
  summary: {
    systemStatus: CopilotSystemContext['systemStatus']
    riskLevel: CopilotSystemContext['riskLevel']
    headline: string
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function pct(value01: number): string {
  return `${Math.round(value01 * 10000) / 100}%`
}

export function runDecisionEngine(context: CopilotSystemContext): CopilotDecisionOutput {
  const diagnoses: CopilotDiagnosis[] = []

  // Setup required
  if (context.domains.length === 0) {
    diagnoses.push({
      type: 'SETUP_REQUIRED',
      issue: 'No sending domains configured',
      cause: 'The system cannot calculate or allocate send capacity without at least one domain.',
      evidence: ['domains.length = 0'],
      recommendedActions: [],
      confidence: 0.95,
    })
  }

  const last24h = context.performance.last24h

  // Low reply rate: only if we have meaningful volume.
  if (last24h.sent >= 100 && last24h.replyRate < 0.005) {
    diagnoses.push({
      type: 'LOW_REPLY_RATE',
      issue: 'Low reply rate',
      cause: 'Likely message-market mismatch or subject fatigue. Top patterns may be stale for this segment.',
      evidence: [
        `sent_24h = ${last24h.sent}`,
        `reply_rate_24h = ${pct(last24h.replyRate)}`,
        `top_patterns_count = ${context.performance.patterns.top.length}`,
      ],
      recommendedActions: [
        {
          title: 'Rotate subject patterns for active sequences',
          detail: 'Pick 2-3 top subject patterns and update the first step subject line for the main sequence(s).',
          tool: 'updateSequence',
          args: {
            // UI will request specific sequence selection; we provide guidance here only.
            mode: 'rotate_subject_patterns',
          },
          requiresApproval: true,
        },
      ],
      confidence: 0.65,
    })
  }

  // High bounce rate: use events-based bounce, plus domain signals.
  if (last24h.sent >= 50 && last24h.bounceRate >= 0.03) {
    const lowAuthDomains = context.domains
      .filter((d) => d.status === 'active')
      .filter((d) => !(d.spfValid && d.dkimValid && d.dmarcValid))
      .slice(0, 5)
      .map((d) => d.domain)

    diagnoses.push({
      type: 'HIGH_BOUNCE_RATE',
      issue: 'Bounce rate is elevated',
      cause: 'Deliverability risk. Potential causes include domain auth gaps, list quality, or volume too high for current reputation.',
      evidence: [
        `sent_24h = ${last24h.sent}`,
        `bounce_rate_24h = ${pct(last24h.bounceRate)}`,
        ...(lowAuthDomains.length ? [`auth_gaps_domains = ${lowAuthDomains.join(', ')}`] : []),
      ],
      recommendedActions: [
        {
          title: 'Reduce send rate by 20% (temporary)',
          detail: 'Lower daily_limit to reduce risk while reviewing domains and list quality.',
          tool: 'adjustSendRate',
          args: { mode: 'reduce_20pct' },
          requiresApproval: true,
        },
      ],
      confidence: 0.8,
    })
  }

  // Domain fatigue: high utilization, backlog, and elevated spam signal.
  const fatigue = context.infraRisk.fatigue
  if (fatigue >= 0.6 || context.queue.retry >= 50) {
    diagnoses.push({
      type: 'QUEUE_BACKLOG',
      issue: 'Queue backlog / slowdowns',
      cause: 'The queue is falling behind schedule. This may indicate constrained infrastructure capacity or aggressive scheduling.',
      evidence: [
        `avg_schedule_lag_seconds = ${context.queue.avgScheduleLagSeconds}`,
        `oldest_pending_seconds = ${context.queue.oldestPendingSeconds}`,
        `retry = ${context.queue.retry}`,
      ],
      recommendedActions: [
        {
          title: 'Reduce send rate by 20% to clear backlog',
          detail: 'Temporarily reduce domain daily limits to let retries and pending work drain.',
          tool: 'adjustSendRate',
          args: { mode: 'reduce_20pct' },
          requiresApproval: true,
        },
      ],
      confidence: clamp01(0.6 + Math.min(0.3, fatigue / 2)),
    })
  }

  // Domain fatigue (more specific)
  if (context.infraRisk.spam >= 0.02 && context.domains.length > 0) {
    const riskyDomains = context.domains
      .filter((d) => d.status === 'active')
      .sort((a, b) => (b.spamRate - a.spamRate) || (a.healthScore - b.healthScore))
      .slice(0, 5)
      .map((d) => `${d.domain}(${Math.round(d.spamRate * 10000) / 100}%)`)

    diagnoses.push({
      type: 'DOMAIN_FATIGUE',
      issue: 'Domain fatigue / inbox placement risk',
      cause: 'Spam placement signals are elevated. This often precedes deliverability degradation if volume is not reduced.',
      evidence: [
        `avg_spam_signal = ${pct(context.infraRisk.spam)}`,
        ...(riskyDomains.length ? [`highest_spam_domains = ${riskyDomains.join(', ')}`] : []),
      ],
      recommendedActions: [
        {
          title: 'Reduce send rate by 20% (placement protection)',
          detail: 'Reduce daily_limit across domains to protect reputation while signals normalize.',
          tool: 'adjustSendRate',
          args: { mode: 'reduce_20pct' },
          requiresApproval: true,
        },
      ],
      confidence: 0.72,
    })
  }

  const headline =
    diagnoses.find((d) => d.type === 'SETUP_REQUIRED')?.issue ??
    diagnoses[0]?.issue ??
    'System is stable'

  return {
    diagnoses,
    summary: {
      systemStatus: context.systemStatus,
      riskLevel: context.riskLevel,
      headline,
    },
  }
}

