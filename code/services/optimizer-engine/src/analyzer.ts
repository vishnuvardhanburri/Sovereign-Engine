export interface OptimizerMetrics {
  bounce_rate: number
  reply_rate: number
  send_success_rate: number
  domain_health: number
}

export interface AnalysisState {
  domainRisk: boolean
  lowPerformance: boolean
  healthy: boolean
}

export function analyze(metrics: OptimizerMetrics): AnalysisState {
  return {
    domainRisk: metrics.bounce_rate > 0.08,
    lowPerformance: metrics.reply_rate < 0.02,
    healthy: metrics.bounce_rate < 0.03,
  }
}

