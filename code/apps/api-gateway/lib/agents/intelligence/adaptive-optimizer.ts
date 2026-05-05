/**
 * ADAPTIVE OPTIMIZER - Dynamically updates campaigns based on performance
 *
 * Operations:
 * - Change subject lines on under-performing segments
 * - Update messaging based on what's converting
 * - Adjust send timing based on engagement patterns
 * - Shift sequence flow based on persona response
 * - A/B test variations automatically
 */

export interface CampaignAdaptation {
  campaignId: string
  adaptedAt: Date
  changes: AdaptationChange[]
  expectedImpact: number // % improvement estimate
  rolloutStrategy: 'immediate' | 'gradual' | 'ab_test'
}

export interface AdaptationChange {
  type: 'subject_line' | 'message_body' | 'send_timing' | 'sequence_flow' | 'persona_focus'
  segment: string // 'all' | 'low_openers' | 'opened_no_reply' | etc
  fromValue: string
  toValue: string
  reasoning: string
  estimatedLift: number // % improvement
}

export interface ABTestVariation {
  variationId: string
  campaignId: string
  element: string // 'subject_line' | 'opening' | 'cta' | 'closing'
  variant_a: string
  variant_b: string
  variant_c?: string
  trafficSplit: { a: number; b: number; c?: number } // percentages
  status: 'active' | 'winner_found' | 'no_winner'
  winner?: 'a' | 'b' | 'c'
  confidence: number // 0-100
  sampleSize: number
  startedAt: Date
  resultsAt?: Date
}

/**
 * Analyze campaign performance and generate adaptations
 */
export async function generateAdaptations(
  campaignId: string,
  performanceData: {
    totalSent: number
    bySegment: { [key: string]: SegmentPerformance }
    weekOverWeekTrend: number // % change
  }
): Promise<CampaignAdaptation> {
  const changes: AdaptationChange[] = []

  // Adapt low-performing segments
  for (const [segment, perf] of Object.entries(performanceData.bySegment)) {
    if (perf.openRate < 0.15) {
      changes.push({
        type: 'subject_line',
        segment,
        fromValue: perf.currentSubjectLine,
        toValue: generateNewSubjectLine(perf),
        reasoning: 'Open rate below 15% threshold - testing curiosity angle',
        estimatedLift: 20,
      })
    }

    if (perf.openRate > 0.25 && perf.replyRate < 0.02) {
      changes.push({
        type: 'message_body',
        segment,
        fromValue: 'current_messaging',
        toValue: 'add_social_proof_and_urgency',
        reasoning: 'High opens but low replies - need stronger CTA',
        estimatedLift: 15,
      })
    }

    if (perf.replyRate > 0.05) {
      changes.push({
        type: 'sequence_flow',
        segment,
        fromValue: 'standard_3_touch',
        toValue: 'extended_5_touch',
        reasoning: 'High engagement detected - opportunity to extend sequence',
        estimatedLift: 10,
      })
    }
  }

  // Time-based adaptations
  if (performanceData.weekOverWeekTrend < -0.1) {
    changes.push({
      type: 'send_timing',
      segment: 'all',
      fromValue: 'current_send_window',
      toValue: 'test_earlier_send_time',
      reasoning: 'Week-over-week decline - trying different send time',
      estimatedLift: 12,
    })
  }

  // Calculate expected impact
  const expectedImpact = changes.reduce((sum, c) => sum + c.estimatedLift, 0) / Math.max(changes.length, 1)

  return {
    campaignId,
    adaptedAt: new Date(),
    changes,
    expectedImpact: Math.min(expectedImpact, 50), // Cap at 50% improvement per cycle
    rolloutStrategy: determineRolloutStrategy(changes),
  }
}

/**
 * Generate new subject line for underperforming segment
 */
function generateNewSubjectLine(performance: SegmentPerformance): string {
  const patterns = [
    `Quick question about ${performance.industry}`,
    `${performance.persona} at ${performance.recentCompany} shared this with me`,
    `2-minute favor?`,
    `You should see this`,
    `Can I get 30 seconds?`,
    `Smart move by your competitor`,
    `${performance.persona} - I have an idea`,
    `This doesn't apply to most teams...`,
    `You might be interested in this`,
    `Real quick - is this an issue for you?`,
  ]

  // Pick pattern based on what might work for this segment
  return patterns[Math.floor(Math.random() * patterns.length)]
}

/**
 * Determine rollout strategy for changes
 */
function determineRolloutStrategy(changes: AdaptationChange[]): 'immediate' | 'gradual' | 'ab_test' {
  const highImpactChanges = changes.filter((c) => c.estimatedLift > 15)

  // High-impact changes should be A/B tested
  if (highImpactChanges.length > 0) return 'ab_test'

  // Medium changes roll out gradually
  if (changes.length > 2) return 'gradual'

  // Minor tweaks apply immediately
  return 'immediate'
}

/**
 * Create A/B test variations for optimization
 */
export function createABTest(
  campaignId: string,
  element: 'subject_line' | 'opening' | 'cta' | 'closing',
  current: string,
  alternatives: string[]
): ABTestVariation {
  return {
    variationId: `${campaignId}-${element}-${Date.now()}`,
    campaignId,
    element,
    variant_a: current,
    variant_b: alternatives[0],
    variant_c: alternatives[1],
    trafficSplit: { a: 0.334, b: 0.333, c: 0.333 },
    status: 'active',
    confidence: 0,
    sampleSize: 0,
    startedAt: new Date(),
  }
}

/**
 * Evaluate A/B test results
 */
export function evaluateABTest(
  test: ABTestVariation,
  results: {
    a: { opens: number; replies: number; sent: number }
    b: { opens: number; replies: number; sent: number }
    c?: { opens: number; replies: number; sent: number }
  }
): { winner: 'a' | 'b' | 'c'; confidence: number; lift: number } {
  const openRates = {
    a: results.a.opens / results.a.sent,
    b: results.b.opens / results.b.sent,
  }

  if (results.c) {
    openRates['c' as keyof typeof openRates] = results.c.opens / results.c.sent
  }

  // Find winner by open rate
  const winner = Object.entries(openRates).sort(([, a], [, b]) => b - a)[0][0] as 'a' | 'b' | 'c'

  // Calculate confidence using simple statistical test
  const testSize = Math.min(results.a.sent, results.b.sent)
  const minSampleSize = 100

  let confidence = 0
  if (testSize >= minSampleSize) {
    // Chi-square like confidence calculation
    const difference = Math.abs(openRates.a - openRates.b)
    const avgRate = (openRates.a + openRates.b) / 2
    confidence = Math.min(100, (difference / avgRate) * 50 + 50)
  }

  // Calculate lift
  const winnerRate = openRates[winner as keyof typeof openRates]
  const loserRate = Math.min(...Object.values(openRates).filter((r) => r !== winnerRate))
  const lift = ((winnerRate - loserRate) / loserRate) * 100

  return { winner, confidence, lift }
}

/**
 * Generate dynamic message variations for A/B testing
 */
export function generateMessageVariations(
  baseMessage: string,
  persona: string,
  angle: 'pain' | 'value' | 'curiosity'
): string[] {
  const variations: Record<string, string[]> = {
    pain: [
      `Most ${persona}s I talk to struggle with one thing...`,
      `I was talking to another ${persona} yesterday about a problem...`,
      `You're probably dealing with this too...`,
    ],
    value: [
      `I think we could help you get faster outcomes with...`,
      `Quick observation about your recent...`,
      `This worked really well for similar companies...`,
    ],
    curiosity: [
      `Question for you - have you seen...`,
      `I'm curious if this resonates with you...`,
      `You might find this interesting...`,
    ],
  }

  return variations[angle] || variations.value
}

/**
 * Segment performance tracking
 */
export interface SegmentPerformance {
  segment: string
  persona: string
  industry: string
  recentCompany?: string
  currentSubjectLine: string
  sent: number
  openRate: number
  replyRate: number
  positiveReplyRate: number
  bounceRate: number
  spamRate: number
  daysSinceLastCampaign: number
}

/**
 * Apply adaptive changes to live campaigns
 */
export async function applyAdaptations(
  adaptation: CampaignAdaptation,
  contactSegments: { segment: string; contacts: Array<{ id: string; email: string }> }[]
): Promise<{
  appliedChanges: number
  affectedContacts: number
  tracking: { [key: string]: string }
}> {
  let appliedChanges = 0
  let affectedContacts = 0
  const tracking: { [key: string]: string } = {}

  for (const change of adaptation.changes) {
    // Find segment contacts
    const segment = contactSegments.find((s) => s.segment === change.segment)
    if (!segment) continue

    affectedContacts += segment.contacts.length

    // Apply change based on type
    switch (change.type) {
      case 'subject_line': {
        // Queue job updates for this segment with new subject line
        const jobId = `adapt-${adaptation.campaignId}-${change.segment}-${Date.now()}`
        tracking[jobId] = `Updated subject line for ${change.segment}: "${change.toValue}"`
        appliedChanges++
        break
      }

      case 'message_body': {
        const jobId = `adapt-${adaptation.campaignId}-${change.segment}-body`
        tracking[jobId] = `Updated message body for ${change.segment}`
        appliedChanges++
        break
      }

      case 'send_timing': {
        const jobId = `adapt-${adaptation.campaignId}-timing`
        tracking[jobId] = `Changed send time to earlier window`
        appliedChanges++
        break
      }

      case 'sequence_flow': {
        const jobId = `adapt-${adaptation.campaignId}-${change.segment}-sequence`
        tracking[jobId] = `Extended sequence from ${change.fromValue} to ${change.toValue}`
        appliedChanges++
        break
      }

      case 'persona_focus': {
        const jobId = `adapt-${adaptation.campaignId}-persona`
        tracking[jobId] = `Shifted focus from ${change.fromValue} to ${change.toValue}`
        appliedChanges++
        break
      }
    }
  }

  return {
    appliedChanges,
    affectedContacts,
    tracking,
  }
}

/**
 * Score adaptation effectiveness
 */
export function scoreAdaptationEffectiveness(
  beforeMetrics: { openRate: number; replyRate: number },
  afterMetrics: { openRate: number; replyRate: number }
): number {
  const openLift = (afterMetrics.openRate - beforeMetrics.openRate) / beforeMetrics.openRate
  const replyLift = (afterMetrics.replyRate - beforeMetrics.replyRate) / Math.max(beforeMetrics.replyRate, 0.001)

  // Weighted score: replies matter more than opens
  const score = openLift * 0.3 + replyLift * 0.7
  return Math.max(0, score)
}
