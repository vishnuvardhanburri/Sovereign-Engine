// @ts-nocheck
/**
 * INFRASTRUCTURE INTEGRATION GUIDE
 *
 * How to use the autonomous infrastructure systems
 *
 * Key Entry Points:
 * 1. coordinator.send(request) - Main email sending operation
 * 2. coordinator.getState() - Get current infrastructure state
 * 3. coordinator.getReport() - Get detailed distribution report
 */

import { coordinator } from '@/lib/infrastructure'

/**
 * EXAMPLE 1: Use in Queue Worker
 *
 * Process email queue with automatic failover and distribution
 */
export async function processEmailQueueWithCoordinator() {
  // Get pending emails from queue
  const emails = await getQueuedEmails(limit = 100)

  const results = []

  for (const email of emails) {
    // Use coordinator to send - handles everything automatically:
    // - Selects healthy inbox
    // - Respects per-inbox limits
    // - Auto-scales if needed
    // - Failover on failure
    // - Logs all events
    const result = await coordinator.send({
      campaignId: email.campaign_id,
      to: email.to,
      from: email.from,
      subject: email.subject,
      html: email.html,
      text: email.text,
      metadata: email.metadata,
    })

    results.push(result)

    if (!result.success) {
      console.error(`Failed to send to ${email.to}: ${result.error}`)
    } else {
      console.log(`Sent via ${result.inboxUsed} (${result.domainUsed})`)
    }
  }

  return results
}

/**
 * EXAMPLE 2: Use in API Route - Get Infrastructure Status
 *
 * Endpoint: GET /api/infrastructure/status
 */
export async function getInfrastructureStatus() {
  const state = await coordinator.getState()

  return {
    currentCapacity: state.currentCapacity,
    targetCapacity: state.targetCapacity,
    utilizationPercent: Math.round(state.capacityUtilization),
    healthyDomains: state.healthyDomains,
    totalInboxes: state.totalInboxes,
    isPaused: state.isPaused,
    systemHealth: {
      isHealthy: state.systemHealth.isHealthy,
      issueCount: state.systemHealth.issues.length,
      issues: state.systemHealth.issues,
    },
    lastHealthCheck: state.lastHealthCheck,
  }
}

/**
 * EXAMPLE 3: Use in API Route - Get Distribution Report
 *
 * Endpoint: GET /api/infrastructure/distribution
 */
export async function getDistributionStatus() {
  const report = await coordinator.getReport()

  return {
    totalInboxes: report.totalInboxes,
    healthyInboxes: report.healthyInboxes,
    fullyUsedInboxes: report.fullyUsedInboxes,
    averageUtilization: Math.round(report.averageUtilization),
    availableCapacity: report.availableCapacity,
    topDistributions: report.distributions.slice(0, 10),
  }
}

/**
 * EXAMPLE 4: Emergency Controls
 *
 * Pause/resume sending in case of issues
 */
export async function pauseSending(reason: string) {
  await coordinator.pause(reason)
  return { status: 'paused', reason }
}

export async function resumeSending() {
  await coordinator.resume()
  return { status: 'resumed' }
}

/**
 * EXAMPLE 5: Monitor in Dashboard
 *
 * Create real-time dashboard with status updates
 */
export async function getDashboardData() {
  const state = await coordinator.getState()
  const report = await coordinator.getReport()

  return {
    // Capacity metrics
    capacity: {
      current: state.currentCapacity,
      target: state.targetCapacity,
      utilization: state.capacityUtilization,
      healthy: state.healthyDomains,
      inboxes: state.totalInboxes,
    },

    // Distribution metrics
    distribution: {
      total: report.totalInboxes,
      healthy: report.healthyInboxes,
      used: report.fullyUsedInboxes,
      available: report.availableCapacity,
    },

    // System health
    health: {
      status: state.systemHealth.isHealthy ? 'healthy' : 'degraded',
      issues: state.systemHealth.issues,
    },

    // Status
    system: {
      isPaused: state.isPaused,
      lastCheck: state.lastHealthCheck,
      lastOptimization: state.lastOptimization,
    },
  }
}

/**
 * DETAILED USAGE FLOW:
 *
 * 1. STARTUP
 *    - coordinator.initialize() is called automatically on import
 *    - Creates tables, initializes systems
 *    - Starts background health checks (every 5 min)
 *    - Starts background optimization (every 1 hour)
 *
 * 2. SENDING EMAIL
 *    await coordinator.send({
 *      campaignId: 'camp123',
 *      to: 'user@example.com',
 *      subject: 'Hello',
 *      html: '<p>Test</p>',
 *      text: 'Test',
 *    })
 *    
 *    Internally:
 *    a. Checks if system is paused
 *    b. Runs health check if needed
 *    c. Selects best healthy inbox
 *    d. Verifies capacity is available
 *    e. Auto-scales if needed
 *    f. Sends email
 *    g. On failure, finds fallback and retries
 *    h. Logs all events
 *
 * 3. BACKGROUND HEALTH CHECK (every 5 minutes)
 *    - Checks for orphaned inboxes
 *    - Checks for inbox imbalance
 *    - Checks for rate limiting
 *    - Checks for expired credentials
 *    - Checks SMTP connectivity
 *    - Auto-heals identified issues
 *    - Auto-resumes paused domains (if cool-off period passed)
 *    - Auto-recovers temporarily unavailable inboxes
 *
 * 4. BACKGROUND OPTIMIZATION (every 1 hour)
 *    - Analyzes distribution strategy performance
 *    - Analyzes warmup schedule effectiveness
 *    - Analyzes time-of-day patterns
 *    - Analyzes domain age impact
 *    - Generates recommendations
 *    - Applies high-confidence recommendations
 *
 * 5. EMERGENCY CONTROLS
 *    - coordinator.pause(reason) - Stop all sending
 *    - coordinator.resume() - Resume sending
 *    - coordinator.getState() - Check status
 *
 * MONITORING CHECKLIST:
 *
 * Critical Alerts (act immediately):
 * ☐ Capacity utilization > 90%
 * ☐ System health degraded (issues detected)
 * ☐ Too many failures (>10% in last hour)
 * ☐ Expired credentials detected
 * ☐ Rate limiting active
 *
 * Important Metrics (check daily):
 * ☐ Bounce rate per domain
 * ☐ Spam rate per domain
 * ☐ Inbox distribution balance
 * ☐ Domain health trends
 * ☐ Optimization changes applied
 *
 * Performance Metrics (weekly):
 * ☐ Average delivery time
 * ☐ Strategy effectiveness
 * ☐ Warmup effectiveness
 * ☐ Failover success rate
 * ☐ Healing action success rate
 */
