/**
 * INFRASTRUCTURE SYSTEMS INDEX
 *
 * Exports all infrastructure systems for easy access
 */

// Core coordinator
export { coordinator } from './coordinator'
export type { InfrastructureState, SendRequest, SendResult } from './coordinator'

// Capacity management
export {
  calculateCapacity,
  getDomainCapacity,
  getAllHealthyDomains,
  checkScalingNeeded,
  getCapacityUtilization,
  calculateSafeSendVolume,
} from './capacity-engine'
export type { CapacityMetrics, DomainMetrics } from './capacity-engine'

// Auto-scaling
export {
  autoScaleIfNeeded,
  addDomain,
  startWarmupForDomain,
  initializeInfrastructureTables,
  getAutoScaleStatus,
} from './auto-scaling'
export type { AutoScaleAction, AutoScaleResult } from './auto-scaling'

// Domain health
export {
  calculateDomainHealth,
  getAllDomainsHealth,
  checkAndActOnDomainHealth,
  pauseDomain,
  resumeDomain,
  autoResumeDomains,
} from './domain-health'
export type { DomainHealth, HealthAlert } from './domain-health'

// Distribution
export {
  selectDistributionTarget,
  selectMultipleDistributionTargets,
  getDistributionReport,
  getAvailableStrategies,
} from './distribution-engine'
export type { DistributionTarget, DistributionStrategy } from './distribution-engine'

// Failover
export {
  handleInboxFailure,
  selectFallbackInbox,
  autoRecoverInboxes,
  getFailoverMetrics,
  isInboxAvailable,
  getInboxStatus,
} from './failover-system'
export type { FailoverEvent, FailoverMetrics } from './failover-system'

// Self-healing
export {
  runSystemHealthCheck,
  autoHeal,
  getHealingHistory,
} from './self-healing'
export type { HealingAction, HealthStatus } from './self-healing'

// Learning
export {
  analyzeStrategyPerformance,
  analyzeWarmupSchedule,
  analyzeTimeOfDayPatterns,
  analyzeDomainAgeImpact,
  generateOptimizationRecommendations,
  learnAndOptimize,
} from './learning-system'
export type { LearningMetrics, OptimizationRecommendation } from './learning-system'
