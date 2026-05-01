export interface PredictiveAnalytics {
  predictedOpenRate: number
  predictedClickRate: number
  predictedReplyRate: number
  optimalSendTime: string
  recommendedSubject: string
  confidence: number
  factors: string[]
}

export interface AutonomousCampaign {
  id: string
  name: string
  status: 'learning' | 'optimizing' | 'peaking' | 'declining'
  performance: {
    currentOpenRate: number
    currentClickRate: number
    currentReplyRate: number
    trend: 'improving' | 'stable' | 'declining'
  }
  optimizations: {
    subjectLines: string[]
    sendTimes: string[]
    contentVariations: string[]
    targetSegments: string[]
  }
  nextActions: AutonomousAction[]
}

export interface AutonomousAction {
  type: 'adjust_send_time' | 'test_subject' | 'segment_contacts' | 'pause_campaign' | 'scale_up'
  reason: string
  expectedImpact: number
  priority: 'high' | 'medium' | 'low'
  data: Record<string, unknown>
}

export interface SmartPersonalization {
  recipientProfile: Record<string, unknown>
  contentStrategy: Record<string, unknown>
  personalizationScore: number
  recommendedContent: string
}

export interface CompetitiveIntelligence {
  marketTrends: string[]
  competitorStrategies: string[]
  industryBenchmarks: Record<string, number>
  emergingOpportunities: string[]
  recommendedDifferentiators: string[]
}

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.error || `Request failed for ${url}`)
  }
  return payload.data as T
}

export async function predictEmailPerformance(
  subject: string,
  content: string,
  recipientProfile: Record<string, unknown>,
  campaignHistory?: unknown[]
): Promise<PredictiveAnalytics> {
  return postJson<PredictiveAnalytics>('/api/ai/generate', {
    action: 'predict_performance',
    subject,
    content,
    recipientProfile,
    campaignHistory,
  })
}

export async function createAutonomousCampaign(
  campaignId: string,
  config: Record<string, unknown>
): Promise<AutonomousCampaign> {
  return postJson<AutonomousCampaign>('/api/optimizer/run', {
    action: 'create_campaign',
    campaignId,
    config,
  })
}

export async function optimizeCampaign(
  campaignId: string,
  metrics: Record<string, unknown>
): Promise<AutonomousAction[]> {
  return postJson<AutonomousAction[]>('/api/ai/generate', {
    action: 'optimize_campaign',
    campaignId,
    metrics,
  })
}

export async function generateSmartPersonalization(
  recipientData: Record<string, unknown>,
  campaignContext: Record<string, unknown>
): Promise<SmartPersonalization> {
  return postJson<SmartPersonalization>('/api/ai/generate', {
    action: 'smart_personalization',
    recipientData,
    campaignContext,
  })
}

export async function analyzeCompetitiveLandscape(
  industry: string,
  targetMarket: string,
  strategy: Record<string, unknown>
): Promise<CompetitiveIntelligence> {
  return postJson<CompetitiveIntelligence>('/api/ai/generate', {
    action: 'competitive_intelligence',
    industry,
    targetMarket,
    strategy,
  })
}

export async function provideAICoaching(
  userAction: string,
  context: Record<string, unknown>,
  history: unknown[]
): Promise<{
  coaching: string
  suggestions: string[]
  warnings: string[]
  nextBestActions: string[]
}> {
  return postJson('/api/ai/generate', {
    action: 'ai_coaching',
    userAction,
    context,
    history,
  })
}

export async function predictLeadConversion(
  leadData: Record<string, unknown>,
  campaignHistory: unknown[],
  marketData: Record<string, unknown>
): Promise<{
  conversionProbability: number
  score: number
  factors: Array<{ factor: string; impact: number; reason: string }>
  recommendedApproach: string
  expectedValue: number
}> {
  return postJson('/api/ai/generate', {
    action: 'predict_conversion',
    leadData,
    campaignHistory,
    marketData,
  })
}

export async function getOptimizationStats(): Promise<{
  activeCampaigns: number
  totalOptimizations: number
  averageImprovement: number
  topPerformingCampaigns: string[]
}> {
  return postJson('/api/optimizer/run', { action: 'get_stats' })
}
