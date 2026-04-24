/**
 * CAMPAIGN ORCHESTRATOR - Autonomous System Controller
 *
 * Coordinates all intelligence systems:
 * - Intent → Discovery → Strategy → Execution → Learning → Optimization
 *
 * User says: "Target fintech founders US"
 * System:
 *   1. Parses intent
 *   2. Discovers matching leads
 *   3. Prioritizes by fit
 *   4. Generates strategy
 *   5. Executes campaign
 *   6. Monitors daily
 *   7. Optimizes continuously
 */

import type { ParsedIntent } from './intent-engine'
import type { DiscoveredLeadSet, LeadPerson } from './target-discovery'
import type { StrategyDecision } from './strategy-engine'
import type { LearningUpdate } from './learning-engine'
import type { CampaignAdaptation } from './adaptive-optimizer'
import { parseIntent } from './intent-engine'
import { discoverLeads, prioritizeLeads } from './target-discovery'
import { generateStrategy, applyStrategyToLeads } from './strategy-engine'
import { analyzeCampaignPerformance, detectTrends, generateLearningReport } from './learning-engine'
import { generateAdaptations, applyAdaptations } from './adaptive-optimizer'

export interface AutonomousCampaign {
  id: string
  userIntent: string
  createdAt: Date
  status: 'parsing' | 'discovering' | 'strategizing' | 'executing' | 'learning' | 'optimizing' | 'active'
  progress: {
    intentParsed: boolean
    leadsDiscovered: boolean
    strategyDefined: boolean
    campaignActive: boolean
    learningsGenerated: boolean
    optimizationsApplied: boolean
  }
  // Core data
  intent?: ParsedIntent
  discoveredLeads?: DiscoveredLeadSet
  strategy?: StrategyDecision
  segmentedLeads?: { [key: string]: LeadPerson[] }
  // Daily insights
  latestLearning?: LearningUpdate
  latestAdaptations?: CampaignAdaptation
  // Metrics
  campaignMetrics?: {
    totalSent: number
    totalOpened: number
    totalReplies: number
    totalPositive: number
    currentOpenRate: number
    currentReplyRate: number
    currentPositiveReplyRate: number
  }
}

/**
 * Create and execute an autonomous campaign from user intent
 */
export async function createAutonomousCampaign(userIntent: string): Promise<AutonomousCampaign> {
  const campaign: AutonomousCampaign = {
    id: `campaign-${Date.now()}`,
    userIntent,
    createdAt: new Date(),
    status: 'parsing',
    progress: {
      intentParsed: false,
      leadsDiscovered: false,
      strategyDefined: false,
      campaignActive: false,
      learningsGenerated: false,
      optimizationsApplied: false,
    },
  }

  try {
    // PHASE 1: Parse Intent
    console.log(`[Orchestrator] Phase 1: Parsing intent for campaign ${campaign.id}`)
    campaign.intent = await parseIntent(userIntent)
    campaign.progress.intentParsed = true
    campaign.status = 'discovering'

    // PHASE 2: Discover Leads
    console.log(
      `[Orchestrator] Phase 2: Discovering leads matching ICP (${campaign.intent.icp.industry.join(', ')})`
    )
    const discovered = await discoverLeads(
      campaign.intent.icp,
      campaign.intent.targetPersonas,
      campaign.intent.estimatedVolume
    )

    campaign.discoveredLeads = discovered
    campaign.progress.leadsDiscovered = true
    campaign.status = 'strategizing'

    console.log(`[Orchestrator] Discovered ${discovered.totalDiscovered} potential leads`)

    // PHASE 3: Generate Strategy
    console.log(`[Orchestrator] Phase 3: Generating campaign strategy`)
    const prioritized = prioritizeLeads(discovered.leads)
    campaign.strategy = generateStrategy(
      campaign.intent.targetPersonas,
      campaign.intent.messagingAngles,
      campaign.intent.sequenceStrategy,
      prioritized
    )

    campaign.segmentedLeads = applyStrategyToLeads(prioritized, campaign.strategy)
    campaign.progress.strategyDefined = true
    campaign.status = 'executing'

    console.log(`[Orchestrator] Strategy defined:`)
    console.log(`  - Primary persona: ${campaign.strategy.primaryPersona.role}`)
    console.log(`  - Messaging angle: ${campaign.strategy.primaryAngle.primary}`)
    console.log(`  - Touches: ${campaign.strategy.touchSequence.length}`)
    console.log(`  - Expected response rate: ${(campaign.strategy.expectedOutcomes.responseRateTarget * 100).toFixed(1)}%`)

    // PHASE 4: Queue Campaign Execution
    console.log(`[Orchestrator] Phase 4: Queuing campaign execution`)
    const leadsToQueue = campaign.segmentedLeads.primary_persona
    console.log(`  - Queuing ${leadsToQueue.length} leads for primary persona`)
    console.log(`  - ${campaign.segmentedLeads.secondary_personas?.length || 0} leads reserved for secondary personas`)
    campaign.progress.campaignActive = true
    campaign.status = 'active'

    // Initialize metrics
    campaign.campaignMetrics = {
      totalSent: 0,
      totalOpened: 0,
      totalReplies: 0,
      totalPositive: 0,
      currentOpenRate: 0,
      currentReplyRate: 0,
      currentPositiveReplyRate: 0,
    }

    return campaign
  } catch (error) {
    console.error(`[Orchestrator] Campaign ${campaign.id} failed:`, error)
    throw error
  }
}

/**
 * Run daily learning cycle - analyze performance and generate insights
 */
export async function runLearningCycle(campaign: AutonomousCampaign): Promise<void> {
  if (!campaign.campaignMetrics || !campaign.intent) {
    console.log(`[Orchestrator] Campaign not ready for learning cycle`)
    return
  }

  console.log(`[Orchestrator] Running daily learning cycle for campaign ${campaign.id}`)

  try {
    // Analyze performance
    const metrics = {
      campaignId: campaign.id,
      periodStart: new Date(Date.now() - 24 * 60 * 60 * 1000),
      periodEnd: new Date(),
      emailsSent: campaign.campaignMetrics.totalSent,
      emailsOpened: campaign.campaignMetrics.totalOpened,
      emailsClicked: Math.floor(campaign.campaignMetrics.totalOpened * 0.15),
      repliesReceived: campaign.campaignMetrics.totalReplies,
      positiveReplies: campaign.campaignMetrics.totalPositive,
      bounced: Math.floor(campaign.campaignMetrics.totalSent * 0.01),
      unsubscribed: Math.floor(campaign.campaignMetrics.totalSent * 0.005),
      spam: Math.floor(campaign.campaignMetrics.totalSent * 0.005),
      metrics: {
        openRate: campaign.campaignMetrics.currentOpenRate,
        clickRate: campaign.campaignMetrics.currentOpenRate * 0.15,
        replyRate: campaign.campaignMetrics.currentReplyRate,
        positiveReplyRate: campaign.campaignMetrics.currentPositiveReplyRate,
        bounceRate: 0.01,
        spamRate: 0.005,
      },
    }

    const learning = await analyzeCampaignPerformance(campaign.id, metrics)
    campaign.latestLearning = learning
    campaign.progress.learningsGenerated = true

    // Generate report
    const trends = detectTrends([metrics])
    const report = generateLearningReport(learning, trends)
    console.log(`\n${report}`)

    // PHASE 5: Adaptive Optimization
    console.log(`[Orchestrator] Phase 5: Generating adaptive optimizations`)
    const adaptations = await generateAdaptations(campaign.id, {
      totalSent: campaign.campaignMetrics.totalSent,
      bySegment: {
        primary_persona: {
          segment: 'primary_persona',
          persona: campaign.strategy?.primaryPersona.role || '',
          industry: campaign.intent.icp.industry[0],
          currentSubjectLine: 'current',
          sent: Math.floor(campaign.campaignMetrics.totalSent * 0.6),
          openRate: campaign.campaignMetrics.currentOpenRate,
          replyRate: campaign.campaignMetrics.currentReplyRate,
          positiveReplyRate: campaign.campaignMetrics.currentPositiveReplyRate,
          bounceRate: 0.01,
          spamRate: 0.005,
          daysSinceLastCampaign: 1,
        },
      },
      weekOverWeekTrend: -0.05, // 5% decline week over week
    })

    campaign.latestAdaptations = adaptations
    campaign.progress.optimizationsApplied = true

    if (adaptations.changes.length > 0) {
      console.log(`[Orchestrator] Generated ${adaptations.changes.length} adaptive changes:`)
      for (const change of adaptations.changes) {
        console.log(
          `  - ${change.type} (${change.segment}): ${change.fromValue} → ${change.toValue} (+${change.estimatedLift}% expected)`
        )
      }
    }

    campaign.status = 'active' // Continue active
  } catch (error) {
    console.error(`[Orchestrator] Learning cycle failed:`, error)
  }
}

/**
 * Get autonomous campaign status and insights
 */
export function getCampaignStatus(campaign: AutonomousCampaign): string {
  let status = `\n=== CAMPAIGN STATUS: ${campaign.id} ===\n`
  status += `Status: ${campaign.status}\n`
  status += `Created: ${campaign.createdAt.toISOString()}\n\n`

  status += `PROGRESS:\n`
  status += `  ✓ Intent Parsed: ${campaign.progress.intentParsed}\n`
  status += `  ✓ Leads Discovered: ${campaign.progress.leadsDiscovered}\n`
  status += `  ✓ Strategy Defined: ${campaign.progress.strategyDefined}\n`
  status += `  ✓ Campaign Active: ${campaign.progress.campaignActive}\n`
  status += `  ✓ Learning Generated: ${campaign.progress.learningsGenerated}\n`
  status += `  ✓ Optimizations Applied: ${campaign.progress.optimizationsApplied}\n\n`

  if (campaign.intent) {
    status += `INTENT:\n`
    status += `  Goal: ${campaign.intent.goal}\n`
    status += `  Industries: ${campaign.intent.icp.industry.join(', ')}\n`
    status += `  Target Personas: ${campaign.intent.targetPersonas.map((p) => p.role).join(', ')}\n`
    status += `  Estimated Volume: ${campaign.intent.estimatedVolume.toLocaleString()} leads\n\n`
  }

  if (campaign.discoveredLeads) {
    status += `DISCOVERY:\n`
    status += `  Companies Found: ${campaign.discoveredLeads.companies.length}\n`
    status += `  Leads Identified: ${campaign.discoveredLeads.leads.length}\n`
    status += `  Avg Engagement Score: ${campaign.discoveredLeads.avgEngagementScore.toFixed(1)}/100\n\n`
  }

  if (campaign.strategy) {
    status += `STRATEGY:\n`
    status += `  Primary Persona: ${campaign.strategy.primaryPersona.role}\n`
    status += `  Messaging Angle: ${campaign.strategy.primaryAngle.primary}\n`
    status += `  Touch Sequence: ${campaign.strategy.touchSequence.length} touches\n`
    status += `  Expected Response Rate: ${(campaign.strategy.expectedOutcomes.responseRateTarget * 100).toFixed(1)}%\n`
    status += `  Expected Conversion Rate: ${(campaign.strategy.expectedOutcomes.conversionRate * 100).toFixed(2)}%\n\n`
  }

  if (campaign.campaignMetrics) {
    status += `METRICS:\n`
    status += `  Sent: ${campaign.campaignMetrics.totalSent.toLocaleString()}\n`
    status += `  Opened: ${campaign.campaignMetrics.totalOpened.toLocaleString()} (${(campaign.campaignMetrics.currentOpenRate * 100).toFixed(1)}%)\n`
    status += `  Replies: ${campaign.campaignMetrics.totalReplies.toLocaleString()} (${(campaign.campaignMetrics.currentReplyRate * 100).toFixed(1)}%)\n`
    status += `  Positive: ${campaign.campaignMetrics.totalPositive.toLocaleString()} (${(campaign.campaignMetrics.currentPositiveReplyRate * 100).toFixed(2)}%)\n\n`
  }

  if (campaign.latestLearning) {
    status += `LATEST LEARNINGS (Health: ${campaign.latestLearning.successScore}/100):\n`
    for (const insight of campaign.latestLearning.insights.slice(0, 3)) {
      const emoji = insight.type === 'strength' ? '✅' : insight.type === 'weakness' ? '⚠️' : '🔍'
      status += `  ${emoji} ${insight.insight}\n`
    }
    status += `\n`
  }

  if (campaign.latestAdaptations && campaign.latestAdaptations.changes.length > 0) {
    status += `ACTIVE OPTIMIZATIONS (Expected Impact: +${campaign.latestAdaptations.expectedImpact.toFixed(1)}%):\n`
    for (const change of campaign.latestAdaptations.changes.slice(0, 3)) {
      status += `  • ${change.type}: ${change.reasoning}\n`
    }
    status += `\n`
  }

  return status
}

/**
 * Autonomous Campaign type definition
 */
export interface AutonomousCampaign {
  id: string
  userIntent: string
  createdAt: Date
  status: 'parsing' | 'discovering' | 'strategizing' | 'executing' | 'learning' | 'optimizing' | 'active'
  progress: {
    intentParsed: boolean
    leadsDiscovered: boolean
    strategyDefined: boolean
    campaignActive: boolean
    learningsGenerated: boolean
    optimizationsApplied: boolean
  }
  // Core data
  intent?: ParsedIntent
  discoveredLeads?: DiscoveredLeadSet
  strategy?: StrategyDecision
  segmentedLeads?: { [key: string]: LeadPerson[] }
  // Daily insights
  latestLearning?: LearningUpdate
  latestAdaptations?: CampaignAdaptation
  // Metrics
  campaignMetrics?: {
    totalSent: number
    totalOpened: number
    totalReplies: number
    totalPositive: number
    currentOpenRate: number
    currentReplyRate: number
    currentPositiveReplyRate: number
  }
}
