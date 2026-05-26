import { appendOperationalEvent } from '@/lib/operational-events'
import { recordUsage } from '@/lib/licensing/enforcement'
import type { WorkflowAction, WorkflowCondition } from '@/lib/workflows/workflow-types'

function getPath(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, segment) => {
    if (value && typeof value === 'object') return (value as Record<string, unknown>)[segment]
    return undefined
  }, source)
}

function compare(condition: WorkflowCondition, payload: Record<string, unknown>): boolean {
  const actual = getPath(payload, condition.path)
  switch (condition.operator) {
    case 'exists':
      return actual !== undefined && actual !== null
    case 'eq':
      return actual === condition.value
    case 'neq':
      return actual !== condition.value
    case 'contains':
      return String(actual ?? '').toLowerCase().includes(String(condition.value ?? '').toLowerCase())
    case 'gt':
      return Number(actual) > Number(condition.value)
    case 'gte':
      return Number(actual) >= Number(condition.value)
    case 'lt':
      return Number(actual) < Number(condition.value)
    case 'lte':
      return Number(actual) <= Number(condition.value)
    default:
      return false
  }
}

export function workflowMatches(conditions: WorkflowCondition[], payload: Record<string, unknown>): boolean {
  return conditions.every((condition) => compare(condition, payload))
}

export async function executeWorkflowActions(input: {
  clientId: number
  workflowId: string
  actions: WorkflowAction[]
  payload: Record<string, unknown>
}): Promise<Array<{ action: string; status: 'planned' | 'emitted' }>> {
  const results: Array<{ action: string; status: 'planned' | 'emitted' }> = []

  for (const action of input.actions) {
    await appendOperationalEvent({
      clientId: input.clientId,
      eventType: `workflow.action.${action.type}`,
      aggregateType: 'workflow',
      aggregateId: input.workflowId,
      actorType: 'worker',
      payload: {
        config: action.config,
        input: input.payload,
      },
    })
    await recordUsage({
      clientId: input.clientId,
      meterType: 'workflow_action',
      source: 'workflow_engine',
      metadata: { workflowId: input.workflowId, action: action.type },
    })
    results.push({ action: action.type, status: 'emitted' })
  }

  return results
}
