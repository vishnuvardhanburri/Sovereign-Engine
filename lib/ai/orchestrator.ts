import { buildSystemContext } from '@/lib/ai/system-context'
import { runDecisionEngine } from '@/lib/ai/decision-engine'
import * as tools from '@/lib/ai/tools'
import { createProposal, confirmProposal, getProposal, markProposalExecuted, remember } from '@/lib/ai/memory'
import { getCopilotSettings } from '@/lib/ai/settings'
import { recordImpact } from '@/lib/ai/impact'

export interface CopilotPlan {
  proposalId: string
  context: Awaited<ReturnType<typeof buildSystemContext>>
  decision: ReturnType<typeof runDecisionEngine>
  actions: Array<{
    id: string
    title: string
    detail: string
    tool: string
    args: Record<string, unknown>
    requiresApproval: true
  }>
}

function actionId(seed: string, index: number): string {
  return `act_${seed}_${index}`
}

export async function proposePlan(input?: { clientId?: number }): Promise<CopilotPlan> {
  const context = await buildSystemContext({ clientId: input?.clientId })
  const decision = runDecisionEngine(context)

  const actions = decision.diagnoses
    .flatMap((d) => d.recommendedActions)
    .map((a, idx) => ({
      id: actionId(String(Date.now()), idx),
      ...a,
    }))

  const proposal = await createProposal({
    clientId: input?.clientId,
    summary: decision.summary.headline,
    proposedActions: actions,
  })

  await remember({
    clientId: input?.clientId,
    scope: 'client',
    kind: 'copilot.plan_proposed',
    payload: {
      proposalId: proposal.id,
      headline: decision.summary.headline,
      riskLevel: context.riskLevel,
      systemStatus: context.systemStatus,
      actionCount: actions.length,
    },
  })

  return {
    proposalId: proposal.id,
    context,
    decision,
    actions,
  }
}

export async function executeIfAutonomousSafe(input: {
  clientId?: number
}): Promise<{ ok: true; executed?: { tool: string; result: any }; skippedReason?: string } | { ok: false; error: string }> {
  const settings = await getCopilotSettings({ clientId: input.clientId })
  if (!settings.autonomousMode) return { ok: true, skippedReason: 'autonomous_mode_off' }

  const before = await buildSystemContext({ clientId: input.clientId })
  const decision = runDecisionEngine(before)

  // Only allow safe, low-risk autonomous actions.
  // Priority order: reduce send rate on elevated bounce, then retry/promote queue.
  const safeCandidates = decision.diagnoses.flatMap((d) => d.recommendedActions)

  const safeToolAllowlist = new Set(['adjustSendRate'])
  let chosen = safeCandidates.find((a) => a.tool === 'adjustSendRate')

  // If no candidate from decision engine, we can still do safe queue recovery if there is backlog.
  if (!chosen && (before.queue.retry > 0 || before.queue.pending > 0)) {
    chosen = {
      title: 'Recover queue',
      detail: 'Promote due jobs and retry failed jobs that are still within max attempts.',
      tool: 'retryFailedQueueJobs',
      args: { limit: 100 },
      requiresApproval: true as const,
    }
  }

  if (!chosen) return { ok: true, skippedReason: 'no_safe_action' }

  const toolName = chosen.tool
  if (toolName === 'adjustSendRate' && safeToolAllowlist.has(toolName) === false) {
    return { ok: true, skippedReason: 'tool_not_safe' }
  }

  const fn = (tools as any)[toolName] as undefined | ((args: any) => Promise<any>)
  if (!fn) return { ok: false, error: `Tool not implemented: ${toolName}` }

  // Execute without manual approval (autonomous safe mode), but still log + impact-track.
  const result = await fn(chosen.args)
  const after = await buildSystemContext({ clientId: input.clientId })

  await recordImpact({
    clientId: input.clientId,
    actionKind: toolName === 'adjustSendRate' ? 'adjust_send_rate' : 'retry_queue',
    actionSummary: `Autonomous: ${chosen.title}`,
    actionPayload: { tool: toolName, args: chosen.args, result },
    before,
    after,
  })

  await remember({
    clientId: input.clientId,
    scope: 'client',
    kind: 'copilot.autonomous_executed',
    payload: {
      tool: toolName,
      args: chosen.args,
      result,
      before: { systemStatus: before.systemStatus, riskLevel: before.riskLevel },
      after: { systemStatus: after.systemStatus, riskLevel: after.riskLevel },
    },
  })

  return { ok: true, executed: { tool: toolName, result } }
}

export async function executeApprovedAction(input: {
  proposalId: string
  actionId: string
  approve: true
}): Promise<{ ok: true; result: any } | { ok: false; error: string }> {
  const proposal = await getProposal(input.proposalId)
  if (!proposal) return { ok: false, error: 'Proposal not found' }
  if (proposal.status !== 'pending') return { ok: false, error: `Proposal is ${proposal.status}` }

  // Explicit approval gate.
  if (!input.approve) return { ok: false, error: 'Approval is required' }

  await confirmProposal(proposal.id)

  const before = await buildSystemContext({ clientId: proposal.client_id })

  const actions = Array.isArray(proposal.proposed_actions) ? proposal.proposed_actions : []
  const action = actions.find((a: any) => a?.id === input.actionId)
  if (!action) return { ok: false, error: 'Action not found in proposal' }

  // Only allow known tools.
  const toolName = String(action.tool ?? '')
  const args = (action.args ?? {}) as Record<string, unknown>

  const allowedWriteTools = new Set([
    'createCampaign',
    'createAndLaunchCampaign',
    'updateSequence',
    'pauseCampaign',
    'adjustSendRate',
  ])

  if (!allowedWriteTools.has(toolName)) {
    return { ok: false, error: `Tool not allowed: ${toolName}` }
  }

  const fn = (tools as any)[toolName] as undefined | ((args: any) => Promise<any>)
  if (!fn) return { ok: false, error: `Tool not implemented: ${toolName}` }

  const result = await fn(args)

  const after = await buildSystemContext({ clientId: proposal.client_id })
  await recordImpact({
    clientId: proposal.client_id,
    actionKind:
      toolName === 'adjustSendRate'
        ? 'adjust_send_rate'
        : toolName === 'pauseCampaign'
          ? 'pause_campaign'
          : toolName === 'updateSequence'
            ? 'rotate_patterns'
            : toolName === 'createCampaign'
              ? 'optimize'
              : 'optimize',
    actionSummary: `Manual: ${String(action.title ?? toolName)}`,
    actionPayload: { tool: toolName, args, result },
    before,
    after,
  })

  await remember({
    scope: 'client',
    kind: 'copilot.action_executed',
    payload: {
      proposalId: proposal.id,
      actionId: input.actionId,
      tool: toolName,
      args,
      result,
    },
  })

  // Mark the proposal executed once we successfully execute a write.
  await markProposalExecuted(proposal.id)

  return { ok: true, result }
}
