import { buildSystemContext } from '@/lib/ai/system-context'
import { runDecisionEngine } from '@/lib/ai/decision-engine'
import * as tools from '@/lib/ai/tools'
import { createProposal, confirmProposal, getProposal, markProposalExecuted, remember } from '@/lib/ai/memory'

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

  const actions = Array.isArray(proposal.proposed_actions) ? proposal.proposed_actions : []
  const action = actions.find((a: any) => a?.id === input.actionId)
  if (!action) return { ok: false, error: 'Action not found in proposal' }

  // Only allow known tools.
  const toolName = String(action.tool ?? '')
  const args = (action.args ?? {}) as Record<string, unknown>

  const allowedWriteTools = new Set([
    'createCampaign',
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

