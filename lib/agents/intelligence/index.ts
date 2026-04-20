/**
 * AUTONOMOUS INTELLIGENCE SYSTEM - Core Exports
 *
 * Xavira Orbit now operates as a true autonomous revenue engine:
 *
 * FROM: Campaign execution tool (user creates campaign, system sends emails)
 * TO: Autonomous intelligence system (user sets goal, system decides everything)
 *
 * THE STACK:
 * 1. INTENT ENGINE — Parse natural language goals into ICP + personas + angles
 * 2. TARGET DISCOVERY — Find matching companies and decision makers
 * 3. STRATEGY ENGINE — Decide optimal persona, angle, sequence
 * 4. LEARNING ENGINE — Daily analysis of what's working
 * 5. ADAPTIVE OPTIMIZER — Dynamically optimize campaigns
 * 6. CAMPAIGN ORCHESTRATOR — Coordinate all systems end-to-end
 *
 * EXECUTION REMAINS:
 * - Queue/worker system (unchanged)
 * - SMTP delivery (unchanged)
 * - Rate limiting & warmup (unchanged)
 * - Database persistence (unchanged)
 *
 * NEW CAPABILITY:
 * User: "Target SaaS founders with $10M revenue in US"
 * System autonomously:
 *   → Parses intent + defines ICP
 *   → Discovers 500+ matching founders
 *   → Scores and prioritizes leads
 *   → Generates 3-touch strategy
 *   → Queues 500 emails across 2 weeks
 *   → Daily: analyzes open/reply rates
 *   → Detects low openers, rotates subject lines
 *   → Detects high engagement, extends sequence
 *   → Reports daily metrics + insights
 *   → Auto-optimizes for 10%+ improvement each week
 */

// Core systems
export { parseIntent, type ParsedIntent, type ICPDefinition, type TargetPerson, type MessagingAngle, type SequenceStrategy } from './intent-engine'

export { discoverLeads, prioritizeLeads, type TargetCompany, type LeadPerson, type DiscoveredLeadSet } from './target-discovery'

export {
  generateStrategy,
  applyStrategyToLeads,
  type StrategyDecision,
  type TouchStrategy,
  type EscalationRule,
} from './strategy-engine'

export {
  analyzeCampaignPerformance,
  detectTrends,
  generateLearningReport,
  type CampaignMetrics,
  type PerformanceInsight,
  type LearningUpdate,
} from './learning-engine'

export {
  generateAdaptations,
  createABTest,
  evaluateABTest,
  generateMessageVariations,
  applyAdaptations,
  scoreAdaptationEffectiveness,
  type CampaignAdaptation,
  type AdaptationChange,
  type ABTestVariation,
} from './adaptive-optimizer'

export {
  createAutonomousCampaign,
  runLearningCycle,
  getCampaignStatus,
  type AutonomousCampaign,
} from './campaign-orchestrator'

/**
 * Quick start: Create autonomous campaign
 *
 * ```typescript
 * import { createAutonomousCampaign } from '@/lib/agents/intelligence'
 *
 * // Create campaign from user intent
 * const campaign = await createAutonomousCampaign('Target SaaS founders US')
 *
 * // Campaign automatically:
 * // 1. Parses intent
 * // 2. Discovers leads
 * // 3. Generates strategy
 * // 4. Queues emails
 * // 5. Ready for daily optimization
 *
 * // Get status anytime
 * console.log(getCampaignStatus(campaign))
 *
 * // Daily learning cycle
 * await runLearningCycle(campaign)
 * ```
 */
