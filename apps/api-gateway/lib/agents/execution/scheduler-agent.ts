import type { BossDecision } from '@/lib/agents/boss-agent'

export interface ScheduleResult {
  scheduledAt: string
  window: string
}

export async function scheduleSend(decision: BossDecision): Promise<ScheduleResult> {
  const offsetMinutes = decision.execution_plan.timing || 30
  const scheduledAt = new Date(Date.now() + offsetMinutes * 60 * 1000).toISOString()
  const window = offsetMinutes <= 60 ? 'next_window' : 'later_window'

  return {
    scheduledAt,
    window,
  }
}
