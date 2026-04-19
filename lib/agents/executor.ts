import type { BossDecision } from '@/lib/agents/boss-agent'
import type { CampaignState, SystemMetrics } from '@/lib/services/metrics'
import type { DomainHealth } from '@/lib/agents/data/domain-health-agent'
import type { OutboundJobPayload } from '@/lib/agents/execution/queue-agent'
import type { SendMessageRequest } from '@/lib/agents/execution/sender-agent'
import type { RateLimitResult } from '@/lib/agents/control/rate-limit-agent'
import type { ComplianceResult } from '@/lib/agents/control/compliance-agent'
import { query } from '@/lib/db'
import { scheduleSend } from '@/lib/agents/execution/scheduler-agent'
import { enqueueOutboundJobs } from '@/lib/agents/execution/queue-agent'
import { sendMessage } from '@/lib/agents/execution/sender-agent'
import { assignFollowUp } from '@/lib/agents/execution/follow-up-agent'
import { retryFailedJob } from '@/lib/agents/execution/retry-agent'
import { validateCompliance } from '@/lib/agents/control/compliance-agent'
import { enforceRateLimit } from '@/lib/agents/control/rate-limit-agent'
import { resolveSelfHealing } from '@/lib/agents/control/self-healing-agent'
import { buildIntroLine } from '@/lib/agents/intelligence/personalization-agent'
import { generateSubjectLines } from '@/lib/agents/intelligence/subject-agent'
import { suggestCampaignImprovements } from '@/lib/agents/intelligence/insight-agent'
import { gatherCompanyInsights } from '@/lib/agents/intelligence/research-agent'
import { selectHealthyDomain } from '@/lib/services/domain-pool'
import { classifyReply, ReplyClassification } from '@/lib/agents/inbox/reply-classifier'
import { buildObjectionStrategy } from '@/lib/agents/inbox/objection-handler'
import { writeResponse } from '@/lib/agents/inbox/response-writer'

export interface ExecutionPayload {
  clientId: number
  jobs: OutboundJobPayload[]
  sendRequest?: SendMessageRequest
  followUp: {
    currentStep: 'step_1' | 'step_2' | 'step_3'
    delayMinutes?: number
  }
  retry: {
    jobId: number
    clientId: number
    attempts: number
    maxAttempts: number
  }
  compliance: {
    clientId: number
    recipientEmails: string[]
  }
  warmupCap?: number
  rateLimitAdjustment?: number
  personalization: {
    company?: string | null
    role?: string | null
    offer?: string | null
    pain?: string | null
  }
  subject: {
    company?: string | null
    angle: 'pattern' | 'pain' | 'authority'
  }
  insight: {
    metrics: SystemMetrics
    domainHealth: DomainHealth
  }
  research: {
    company?: string | null
    domain?: string | null
  }
  replyText: string
  objection: string
  response: {
    classification: ReplyClassification
    originalMessage: string
  }
}

export interface ExecutionContext {
  bossDecision: BossDecision
  campaignState: CampaignState
  systemMetrics: SystemMetrics
  domainHealth: DomainHealth
  payload: ExecutionPayload
}

export interface ExecutorReport {
  [agentName: string]: unknown
}

const agentMap: Record<string, (context: ExecutionContext) => Promise<unknown>> = {
  SchedulerAgent: async (context) => scheduleSend(context.bossDecision),
  QueueAgent: async (context) => enqueueOutboundJobs(context.payload.jobs),
  SenderAgent: async (context) => sendMessage(context.payload.sendRequest!),
  FollowUpAgent: async (context) => assignFollowUp(context.payload.followUp),
  RetryAgent: async (context) => retryFailedJob(context.payload.retry),
  ComplianceAgent: async (context) => validateCompliance(context.payload.compliance),
  RateLimitAgent: async (context) => enforceRateLimit({
    clientId: context.payload.clientId,
    requestedVolume: context.payload.jobs.length,
    adjustment: context.payload.rateLimitAdjustment ?? 0,
    warmupCap: context.payload.warmupCap,
  }),
  PersonalizationAgent: async (context) => buildIntroLine(context.payload.personalization),
  SubjectAgent: async (context) => generateSubjectLines(context.payload.subject),
  InsightAgent: async (context) => suggestCampaignImprovements(context.payload.insight),
  ResearchAgent: async (context) => gatherCompanyInsights(context.payload.research),
  ReplyClassifier: async (context) => classifyReply(context.payload.replyText),
  ObjectionHandler: async (context) => buildObjectionStrategy(context.payload.objection as any),
  ResponseWriter: async (context) => writeResponse(context.payload.response),
}

export async function executeDecision(context: ExecutionContext): Promise<ExecutorReport> {
  const results: ExecutorReport = {}

  if (context.bossDecision.decision === 'pause') {
    results.pause = {
      skipped: true,
      reason: context.bossDecision.reason,
    }
    return results
  }

  await assignDomainToJobs(context)

  for (const target of context.bossDecision.target_agents) {
    const handler = agentMap[target]
    if (!handler) {
      results[target] = { error: 'no handler registered' }
      continue
    }

    try {
      const result = await handler(context)
      results[target] = result

      if (target === 'RateLimitAgent') {
        const rateResult = result as RateLimitResult
        if (rateResult.allowedVolume === 0) {
          results.aborted = {
            reason: 'rate limit prevented execution',
            details: rateResult,
          }
          break
        }

        if (context.payload.jobs.length > rateResult.allowedVolume) {
          context.payload.jobs = context.payload.jobs.slice(0, rateResult.allowedVolume)
          results.rateLimitAdjustment = {
            allowedVolume: rateResult.allowedVolume,
            queuedJobs: context.payload.jobs.length,
          }
        }
      }

      if (target === 'ComplianceAgent') {
        const complianceResult = result as ComplianceResult
        if (!complianceResult.allowed) {
          results.aborted = {
            reason: 'compliance validation failed',
            details: complianceResult,
          }
          break
        }
      }
    } catch (error) {
      const healing = await resolveSelfHealing({
        error,
        system_state: {
          metrics: context.systemMetrics,
          campaignState: context.campaignState,
        },
        domain: context.domainHealth,
      })

      results[target] = {
        error: normalizeError(error),
        recovery: healing,
      }

      await applyRecovery(healing, context)
      break
    }
  }

  return results
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    }
  }

  return {
    message: String(error),
  }
}

async function applyRecovery(
  healing: Awaited<ReturnType<typeof resolveSelfHealing>>,
  context: ExecutionContext
) {
  switch (healing.action) {
    case 'retry':
      await retryOutboundJobs(context.payload.jobs, healing.recovery_plan.retry_after_seconds)
      break
    case 'delay':
      await retryOutboundJobs(context.payload.jobs, healing.recovery_plan.retry_after_seconds)
      break
    case 'reduce_volume':
      await reduceDomainLimit(context.domainHealth.domainId, healing.recovery_plan.volume_adjustment)
      context.payload.jobs = context.payload.jobs.slice(
        0,
        Math.max(0, context.payload.jobs.length - healing.recovery_plan.volume_adjustment)
      )
      break
    case 'pause':
      await pauseCampaign(context.campaignState.campaignId)
      break
    case 'reroute':
      await rerouteOutboundJobs(context.payload.jobs, healing.recovery_plan.retry_after_seconds)
      break
  }
}

async function retryOutboundJobs(jobs: OutboundJobPayload[], delaySeconds: number) {
  if (jobs.length === 0) {
    return
  }

  const scheduledJobs = jobs.map((job) => ({
    ...job,
    scheduledAt: new Date(Date.now() + delaySeconds * 1000).toISOString(),
  }))

  await enqueueOutboundJobs(scheduledJobs)
}

async function assignDomainToJobs(context: ExecutionContext): Promise<void> {
  if (!context.bossDecision.target_agents.includes('QueueAgent')) {
    return
  }

  const domain = await selectHealthyDomain(
    context.payload.clientId,
    context.campaignState.campaignId ?? 0
  )

  if (!domain) {
    return
  }

  context.payload.jobs = context.payload.jobs.map((job) => ({
    ...job,
    domainId: domain.domainId,
  }))
}

async function rerouteOutboundJobs(jobs: OutboundJobPayload[], delaySeconds: number) {
  await retryOutboundJobs(jobs, delaySeconds)
}

async function reduceDomainLimit(domainId: number | null, adjustment: number) {
  if (!domainId || adjustment <= 0) {
    return
  }

  await query(
    `UPDATE domains
     SET daily_limit = GREATEST(0, daily_limit - $1),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [adjustment, domainId]
  )
}

async function pauseCampaign(campaignId: number | null) {
  if (!campaignId) {
    return
  }

  await query(
    `UPDATE campaigns
     SET status = 'paused',
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [campaignId]
  )
}
