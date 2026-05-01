import type { Lane } from '@sovereign/types'
import type { AnalysisState } from './analyzer'

export type PolicyAction =
  | { action: 'reduce_volume'; factor: number }
  | { action: 'increase_volume'; factor: number }
  | { action: 'shift_lane'; to: Lane }
  | { action: 'pause_domain' }
  | { action: 'no_change' }

export function adjust(state: AnalysisState): PolicyAction {
  if (state.domainRisk) {
    return { action: 'reduce_volume', factor: 0.5 }
  }

  if (state.lowPerformance) {
    return { action: 'shift_lane', to: 'slow' }
  }

  if (state.healthy) {
    return { action: 'increase_volume', factor: 1.2 }
  }

  return { action: 'no_change' }
}

