export type WorkflowConditionOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'exists'

export interface WorkflowCondition {
  path: string
  operator: WorkflowConditionOperator
  value?: unknown
}

export interface WorkflowAction {
  type:
    | 'append_event'
    | 'notify_operator'
    | 'pause_lane'
    | 'queue_follow_up'
    | 'sync_crm'
    | 'mark_conversation'
  config: Record<string, unknown>
}

export interface WorkflowDefinitionShape {
  triggerType: string
  conditions: WorkflowCondition[]
  actions: WorkflowAction[]
  rollbackPlan?: Record<string, unknown>
  governancePolicy?: Record<string, unknown>
}
