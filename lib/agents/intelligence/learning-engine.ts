/**
 * LEARNING ENGINE - Analyzes performance and adapts system behavior
 *
 * Daily operations:
 * - Detect what's working (high response, high conversion)
 * - Identify what's failing (bounces, spam, low engagement)
 * - Update system behavior based on learnings
 * - Feed insights to other agents
 */

export interface CampaignMetrics {
  campaignId: string
  periodStart: Date
  periodEnd: Date
  emailsSent: number
  emailsOpened: number
  emailsClicked: number
  repliesReceived: number
  positiveReplies: number
  bounced: number
  unsubscribed: number
  spam: number
  metrics: {
    openRate: number
    clickRate: number
    replyRate: number
    positiveReplyRate: number
    bounceRate: number
    spamRate: number
  }
}

export interface PerformanceInsight {
  type: 'strength' | 'weakness' | 'opportunity' | 'threat'
  dimension: string // 'subject_line' | 'messaging_angle' | 'persona' | 'timing' | 'tone'
  insight: string
  evidence: string
  confidence: number // 0-100
  recommendation: string
  impactEstimate: number // Expected % improvement if applied
}

export interface LearningUpdate {
  campaignId: string
  analyzedAt: Date
  insights: PerformanceInsight[]
  updatesToApply: {
    messagingAngleFocus?: string // Best performing angle
    personaShift?: string // Most responsive persona
    subjectLinePattern?: string // Most effective pattern
    sendTimeOptimization?: string // Best send times
    contentLength?: 'shorter' | 'longer' | 'current'
    frequencyAdjustment?: number // Daily send rate multiplier
  }
  successScore: number // 0-100 overall campaign health
}

/**
 * Analyze campaign performance and generate learning updates
 */
export async function analyzeCampaignPerformance(
  campaignId: string,
  metrics: CampaignMetrics
): Promise<LearningUpdate> {
  const insights = generateInsights(metrics)
  const updates = generateUpdates(insights)
  const successScore = calculateSuccessScore(metrics)

  return {
    campaignId,
    analyzedAt: new Date(),
    insights,
    updatesToApply: updates,
    successScore,
  }
}

/**
 * Generate actionable insights from metrics
 */
function generateInsights(metrics: CampaignMetrics): PerformanceInsight[] {
  const insights: PerformanceInsight[] = []

  // High open rate insight
  if (metrics.metrics.openRate > 0.35) {
    insights.push({
      type: 'strength',
      dimension: 'subject_line',
      insight: 'Subject lines are highly compelling',
      evidence: `${(metrics.metrics.openRate * 100).toFixed(1)}% open rate (industry avg: 25%)`,
      confidence: 95,
      recommendation: 'Maintain current subject line strategy, consider A/B testing variations',
      impactEstimate: 5,
    })
  }

  // Low open rate insight
  if (metrics.metrics.openRate < 0.15) {
    insights.push({
      type: 'weakness',
      dimension: 'subject_line',
      insight: 'Subject lines need improvement',
      evidence: `${(metrics.metrics.openRate * 100).toFixed(1)}% open rate (industry avg: 25%)`,
      confidence: 95,
      recommendation: 'Test curiosity-driven subject lines, personalization, urgency angles',
      impactEstimate: 20,
    })
  }

  // High reply rate insight
  if (metrics.metrics.replyRate > 0.05) {
    insights.push({
      type: 'strength',
      dimension: 'messaging_angle',
      insight: 'Message resonates strongly with audience',
      evidence: `${(metrics.metrics.replyRate * 100).toFixed(1)}% reply rate (industry avg: 1-3%)`,
      confidence: 95,
      recommendation: 'Scale volume, replicate messaging framework to other campaigns',
      impactEstimate: 0, // Already working
    })
  }

  // Low reply rate but high opens
  if (metrics.metrics.openRate > 0.3 && metrics.metrics.replyRate < 0.02) {
    insights.push({
      type: 'opportunity',
      dimension: 'messaging_angle',
      insight: 'Getting attention but not compelling action',
      evidence: `${(metrics.metrics.openRate * 100).toFixed(1)}% opens but only ${(metrics.metrics.replyRate * 100).toFixed(1)}% replies`,
      confidence: 85,
      recommendation: 'Strengthen CTAs, add urgency, make ask more specific and valuable',
      impactEstimate: 15,
    })
  }

  // High bounce rate insight
  if (metrics.metrics.bounceRate > 0.05) {
    insights.push({
      type: 'threat',
      dimension: 'data_quality',
      insight: 'Email list quality issues detected',
      evidence: `${(metrics.metrics.bounceRate * 100).toFixed(1)}% bounce rate (healthy: <2%)`,
      confidence: 95,
      recommendation: 'Validate email list with verification tool, segment out bounced domains',
      impactEstimate: 30,
    })
  }

  // High spam rate insight
  if (metrics.metrics.spamRate > 0.02) {
    insights.push({
      type: 'threat',
      dimension: 'deliverability',
      insight: 'Content triggering spam filters',
      evidence: `${(metrics.metrics.spamRate * 100).toFixed(1)}% marked as spam (healthy: <1%)`,
      confidence: 90,
      recommendation: 'Remove promotional language, reduce links, warm up domain, reduce volume',
      impactEstimate: 40,
    })
  }

  // High positive reply rate
  if (metrics.metrics.positiveReplyRate > 0.006) {
    insights.push({
      type: 'strength',
      dimension: 'persona_targeting',
      insight: 'Right audience, right message',
      evidence: `${(metrics.metrics.positiveReplyRate * 100).toFixed(1)}% positive reply rate (excellent)`,
      confidence: 95,
      recommendation: 'Identify common characteristics of positive responders, double down',
      impactEstimate: 10,
    })
  }

  // Low positive reply rate
  if (metrics.metrics.replyRate > 0.03 && metrics.metrics.positiveReplyRate < 0.003) {
    insights.push({
      type: 'weakness',
      dimension: 'persona_targeting',
      insight: 'Getting replies but mostly objections/rejections',
      evidence: `${(metrics.metrics.replyRate * 100).toFixed(1)}% reply rate but only ${(metrics.metrics.positiveReplyRate * 100).toFixed(2)}% positive`,
      confidence: 90,
      recommendation: 'Refine ICP, target different persona, improve messaging relevance',
      impactEstimate: 25,
    })
  }

  // Optimal timing success
  if (metrics.metrics.openRate > 0.25 && metrics.metrics.replyRate > 0.03) {
    insights.push({
      type: 'strength',
      dimension: 'timing',
      insight: 'Send times are well-optimized',
      evidence: 'Strong open and reply rates indicate good timing strategy',
      confidence: 75,
      recommendation: 'Continue current send window timing',
      impactEstimate: 0,
    })
  }

  return insights.slice(0, 5) // Return top 5 insights
}

/**
 * Generate specific updates to apply to future campaigns
 */
function generateUpdates(
  insights: PerformanceInsight[]
): LearningUpdate['updatesToApply'] {
  const updates: LearningUpdate['updatesToApply'] = {}

  for (const insight of insights) {
    if (insight.dimension === 'subject_line') {
      if (insight.type === 'strength') {
        updates.subjectLinePattern = 'curiosity_personalized'
      } else if (insight.type === 'weakness') {
        updates.subjectLinePattern = 'urgency_specific'
      }
    }

    if (insight.dimension === 'messaging_angle') {
      if (insight.type === 'strength') {
        updates.messagingAngleFocus = 'maintain_current'
      } else if (insight.type === 'opportunity') {
        updates.messagingAngleFocus = 'add_urgency'
      }
    }

    if (insight.dimension === 'data_quality' && insight.type === 'threat') {
      updates.frequencyAdjustment = 0.5 // Reduce volume by half
    }

    if (insight.dimension === 'deliverability' && insight.type === 'threat') {
      updates.frequencyAdjustment = 0.3 // Reduce volume significantly
      updates.contentLength = 'shorter'
    }

    if (insight.dimension === 'persona_targeting') {
      if (insight.type === 'strength') {
        updates.personaShift = 'continue_current'
      } else if (insight.type === 'weakness') {
        updates.personaShift = 'escalate_to_executive'
      }
    }
  }

  return updates
}

/**
 * Calculate overall campaign health score
 */
function calculateSuccessScore(metrics: CampaignMetrics): number {
  let score = 50 // Base score

  // Open rate weight: 25 points
  if (metrics.metrics.openRate > 0.3) score += 25
  else if (metrics.metrics.openRate > 0.2) score += 15
  else if (metrics.metrics.openRate > 0.1) score += 5

  // Reply rate weight: 25 points
  if (metrics.metrics.replyRate > 0.05) score += 25
  else if (metrics.metrics.replyRate > 0.03) score += 15
  else if (metrics.metrics.replyRate > 0.01) score += 5

  // Positive reply rate weight: 20 points
  if (metrics.metrics.positiveReplyRate > 0.008) score += 20
  else if (metrics.metrics.positiveReplyRate > 0.005) score += 10

  // Bounce rate penalty: -15 points
  if (metrics.metrics.bounceRate > 0.05) score -= 15
  else if (metrics.metrics.bounceRate > 0.02) score -= 5

  // Spam rate penalty: -15 points
  if (metrics.metrics.spamRate > 0.02) score -= 15
  else if (metrics.metrics.spamRate > 0.01) score -= 5

  return Math.max(0, Math.min(100, score))
}

/**
 * Detect trends over time
 */
export function detectTrends(
  metricsHistory: CampaignMetrics[]
): {
  trendDirection: 'improving' | 'declining' | 'stable'
  momentumScore: number
  warnings: string[]
} {
  if (metricsHistory.length < 2) {
    return {
      trendDirection: 'stable',
      momentumScore: 0,
      warnings: [],
    }
  }

  const recent = metricsHistory[metricsHistory.length - 1]
  const previous = metricsHistory[metricsHistory.length - 2]

  const replyRateDelta = recent.metrics.replyRate - previous.metrics.replyRate
  const openRateDelta = recent.metrics.openRate - previous.metrics.openRate
  const bounceRateDelta = recent.metrics.bounceRate - previous.metrics.bounceRate

  // Calculate momentum
  let momentum = 0
  if (replyRateDelta > 0.005) momentum += 30
  if (openRateDelta > 0.05) momentum += 20
  if (bounceRateDelta < -0.01) momentum += 10

  const trendDirection = momentum > 0 ? 'improving' : momentum < -20 ? 'declining' : 'stable'

  const warnings: string[] = []
  if (bounceRateDelta > 0.01) warnings.push('Bounce rate increasing - check list quality')
  if (replyRateDelta < -0.01) warnings.push('Reply rate declining - refresh messaging')

  return {
    trendDirection,
    momentumScore: momentum,
    warnings,
  }
}

/**
 * Generate summary report for stakeholders
 */
export function generateLearningReport(
  learning: LearningUpdate,
  trends: { trendDirection: string; momentumScore: number; warnings: string[] }
): string {
  let report = `## Campaign Learning Report\n\n`
  report += `**Campaign ID:** ${learning.campaignId}\n`
  report += `**Health Score:** ${learning.successScore}/100\n`
  report += `**Trend:** ${trends.trendDirection} (momentum: ${trends.momentumScore})\n\n`

  report += `### Key Insights\n`
  for (const insight of learning.insights) {
    const emoji = insight.type === 'strength' ? '✅' : insight.type === 'weakness' ? '⚠️' : '🔍'
    report += `${emoji} **${insight.dimension}**: ${insight.insight}\n`
    report += `   Evidence: ${insight.evidence}\n`
    report += `   Recommendation: ${insight.recommendation}\n`
    report += `   Impact potential: +${insight.impactEstimate}%\n\n`
  }

  report += `### Updates to Apply\n`
  if (learning.updatesToApply.messagingAngleFocus) {
    report += `- **Messaging**: Focus on ${learning.updatesToApply.messagingAngleFocus}\n`
  }
  if (learning.updatesToApply.personaShift) {
    report += `- **Persona**: ${learning.updatesToApply.personaShift}\n`
  }
  if (learning.updatesToApply.frequencyAdjustment) {
    report += `- **Volume**: Adjust to ${(learning.updatesToApply.frequencyAdjustment * 100).toFixed(0)}% of current\n`
  }

  if (trends.warnings.length > 0) {
    report += `\n### ⚠️ Warnings\n`
    for (const warning of trends.warnings) {
      report += `- ${warning}\n`
    }
  }

  return report
}
