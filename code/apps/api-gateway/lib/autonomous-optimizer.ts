export interface OptimizationMetrics {
  campaignId: string
  timestamp: Date
  openRate: number
  clickRate: number
  replyRate: number
  bounceRate: number
  unsubscribeRate: number
  spamComplaints: number
  conversions: number
  revenue: number
}

export interface OptimizationResult {
  campaignId: string
  actions: Array<{
    type: string
    reason: string
    expectedImpact: number
    priority: 'high' | 'medium' | 'low'
    data: Record<string, unknown>
  }>
  predictedImprovement: number
  confidence: number
  reasoning: string
}

async function postJson<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/autonomous-optimizer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.error || 'Request failed')
  }

  return payload.data as T
}

export async function startAutonomousOptimization(): Promise<void> {
  await postJson<void>({ action: 'start' })
}

export async function stopAutonomousOptimization(): Promise<void> {
  await postJson<void>({ action: 'stop' })
}

export async function addCampaignToAutonomousOptimization(
  campaignId: string,
  config: Record<string, unknown>
): Promise<void> {
  await postJson<void>({ action: 'add_campaign', campaignId, config })
}

export async function getOptimizationStats(): Promise<{
  activeCampaigns: number
  totalOptimizations: number
  averageImprovement: number
  topPerformingCampaigns: string[]
}> {
  return postJson({ action: 'get_stats' })
}

export function getAutonomousOptimizer() {
  return {
    removeCampaign: async (_campaignId: string) => {
      await postJson<void>({ action: 'remove_campaign', campaignId: _campaignId })
    },
  }
}
