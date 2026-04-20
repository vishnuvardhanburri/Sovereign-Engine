/**
 * INFRASTRUCTURE COORDINATOR
 *
 * Orchestrates all infrastructure systems:
 * - Capacity Engine: Calculates current/needed capacity
 * - Auto-Scaling: Provisions new domains/inboxes
 * - Domain Health: Monitors bounce/spam rates
 * - Distribution Engine: Routes emails intelligently
 * - Failover System: Handles failures gracefully
 * - Self-Healing: Auto-fixes common issues
 * - Learning System: Optimizes over time
 *
 * Main entry point for email sending operations
 */

import { query, transaction } from '@/lib/db'
import { calculateCapacity, getCapacityUtilization } from './capacity-engine'
import { autoScaleIfNeeded } from './auto-scaling'
import { calculateDomainHealth, checkAndActOnDomainHealth, autoResumeDomains } from './domain-health'
import { selectDistributionTarget, getDistributionReport } from './distribution-engine'
import { handleInboxFailure, autoRecoverInboxes } from './failover-system'
import { runSystemHealthCheck, autoHeal } from './self-healing'
import { learnAndOptimize } from './learning-system'

export interface InfrastructureState {
  currentCapacity: number
  targetCapacity: number
  capacityUtilization: number
  healthyDomains: number
  totalInboxes: number
  isPaused: boolean
  lastHealthCheck: Date
  lastOptimization: Date
  systemHealth: {
    isHealthy: boolean
    issues: string[]
  }
}

export interface SendRequest {
  campaignId: string
  to: string
  from?: string
  subject: string
  html: string
  text: string
  metadata?: Record<string, any>
}

export interface SendResult {
  success: boolean
  messageId?: string
  inboxUsed?: string
  domainUsed?: string
  error?: string
  timestamp: Date
}

class InfrastructureCoordinator {
  private lastHealthCheck: Date = new Date()
  private lastOptimization: Date = new Date()
  private isPaused: boolean = false
  private healthCheckInterval: number = 5 * 60 * 1000 // 5 minutes
  private optimizationInterval: number = 60 * 60 * 1000 // 1 hour

  /**
   * Initialize coordinator (run on startup)
   */
  async initialize(): Promise<void> {
    console.log('[Coordinator] Initializing infrastructure systems...')

    try {
      // Initialize database tables
      await query(`
        CREATE TABLE IF NOT EXISTS domains (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          domain VARCHAR(255) UNIQUE NOT NULL,
          status VARCHAR(50) DEFAULT 'active',
          bounce_rate DECIMAL(5,4) DEFAULT 0,
          spam_rate DECIMAL(5,4) DEFAULT 0,
          warmup_stage INT DEFAULT 1,
          paused_until TIMESTAMP,
          api_token_expires_at TIMESTAMP,
          sending_throttle DECIMAL(3,2) DEFAULT 1.0,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `)

      console.log('[Coordinator] Infrastructure tables ready')

      // Start background tasks
      this.startBackgroundTasks()
    } catch (error) {
      console.error('[Coordinator] Initialization error:', error)
    }
  }

  /**
   * Main send operation
   */
  async send(request: SendRequest): Promise<SendResult> {
    const startTime = Date.now()

    try {
      // Pre-checks
      if (this.isPaused) {
        return {
          success: false,
          error: 'System paused',
          timestamp: new Date(),
        }
      }

      // Run periodic checks if needed
      await this.checkIfNeeded()

      // Select distribution target
      const target = await selectDistributionTarget('health_priority')

      if (!target) {
        return {
          success: false,
          error: 'No healthy inboxes available',
          timestamp: new Date(),
        }
      }

      // Verify capacity is available
      const capacity = await calculateCapacity()
      if (capacity.capacityGapPercentage > 80) {
        // Trigger scaling
        const scaleResults = await autoScaleIfNeeded()
        if (!scaleResults.some((r) => r.success)) {
          return {
            success: false,
            error: 'Insufficient capacity and scaling failed',
            timestamp: new Date(),
          }
        }
      }

      // Send email
      const messageId = await this.sendEmail(target, request)

      if (!messageId) {
        // Handle send failure
        const failover = await handleInboxFailure(
          target.inboxId,
          'Send operation failed',
          'smtp_error'
        )

        if (!failover?.fallbackInboxId) {
          return {
            success: false,
            error: 'Send failed and no fallback available',
            timestamp: new Date(),
          }
        }

        // Retry with fallback
        const retryTarget = await selectDistributionTarget('health_priority')
        if (retryTarget) {
          const retryMessageId = await this.sendEmail(retryTarget, request)
          if (retryMessageId) {
            return {
              success: true,
              messageId: retryMessageId,
              inboxUsed: retryTarget.inboxEmail,
              domainUsed: retryTarget.domain,
              timestamp: new Date(),
            }
          }
        }

        return {
          success: false,
          error: 'Send and retry both failed',
          timestamp: new Date(),
        }
      }

      // Log success
      const duration = Date.now() - startTime
      await query(
        `INSERT INTO events (campaign_id, type, from_inbox_id, domain_id, message_id, duration_ms)
        VALUES ($1, $2, $3, $4, $5, $6)`,
        [request.campaignId, 'sent', target.inboxId, target.domainId, messageId, duration]
      )

      return {
        success: true,
        messageId,
        inboxUsed: target.inboxEmail,
        domainUsed: target.domain,
        timestamp: new Date(),
      }
    } catch (error) {
      console.error('[Coordinator] Send error:', error)
      return {
        success: false,
        error: String(error),
        timestamp: new Date(),
      }
    }
  }

  /**
   * Send email via selected inbox
   */
  private async sendEmail(target: any, request: SendRequest): Promise<string | null> {
    try {
      // TODO: Integrate with actual SMTP provider
      // For now, simulate sending

      // Generate message ID
      const messageId = `${Date.now()}-${Math.random().toString(36).substring(7)}`

      // Simulate 99% success rate
      if (Math.random() < 0.99) {
        return messageId
      }

      return null
    } catch (error) {
      console.error('[Coordinator] Email send error:', error)
      return null
    }
  }

  /**
   * Run health check if interval has passed
   */
  private async checkIfNeeded(): Promise<void> {
    const now = Date.now()

    // Health check every 5 minutes
    if (now - this.lastHealthCheck.getTime() > this.healthCheckInterval) {
      await this.runHealthCheck()
      this.lastHealthCheck = new Date()
    }

    // Optimization every hour
    if (now - this.lastOptimization.getTime() > this.optimizationInterval) {
      await this.runOptimization()
      this.lastOptimization = new Date()
    }
  }

  /**
   * Run comprehensive health check
   */
  private async runHealthCheck(): Promise<void> {
    console.log('[Coordinator] Running health check...')

    try {
      const health = await runSystemHealthCheck()

      if (!health.isHealthy) {
        console.warn('[Coordinator] System issues detected:', health.issues)

        // Auto-heal
        const actions = await autoHeal()
        console.log('[Coordinator] Applied', actions.length, 'healing actions')
      }

      // Check domain health and auto-resume
      const resumed = await autoResumeDomains()
      if (resumed.length > 0) {
        console.log('[Coordinator] Auto-resumed', resumed.length, 'domains')
      }

      // Auto-recover inboxes
      const recovered = await autoRecoverInboxes()
      if (recovered.length > 0) {
        console.log('[Coordinator] Auto-recovered', recovered.length, 'inboxes')
      }
    } catch (error) {
      console.error('[Coordinator] Health check error:', error)
    }
  }

  /**
   * Run optimization
   */
  private async runOptimization(): Promise<void> {
    console.log('[Coordinator] Running optimization...')

    try {
      const result = await learnAndOptimize()
      console.log('[Coordinator] Optimization complete:', result)
    } catch (error) {
      console.error('[Coordinator] Optimization error:', error)
    }
  }

  /**
   * Start background tasks
   */
  private startBackgroundTasks(): void {
    // Health check interval
    setInterval(() => this.runHealthCheck(), this.healthCheckInterval)

    // Optimization interval
    setInterval(() => this.runOptimization(), this.optimizationInterval)

    console.log('[Coordinator] Background tasks started')
  }

  /**
   * Get current infrastructure state
   */
  async getState(): Promise<InfrastructureState> {
    const capacity = await calculateCapacity()
    const utilization = await getCapacityUtilization()
    const health = await runSystemHealthCheck()

    return {
      currentCapacity: capacity.currentCapacity,
      targetCapacity: capacity.targetDailyVolume,
      capacityUtilization: utilization,
      healthyDomains: capacity.healthyDomains,
      totalInboxes: capacity.totalInboxes,
      isPaused: this.isPaused,
      lastHealthCheck: this.lastHealthCheck,
      lastOptimization: this.lastOptimization,
      systemHealth: {
        isHealthy: health.isHealthy,
        issues: health.issues.map((i) => i.description),
      },
    }
  }

  /**
   * Get distribution report
   */
  async getReport(): Promise<any> {
    return getDistributionReport()
  }

  /**
   * Pause sending (emergency)
   */
  async pause(reason: string): Promise<void> {
    this.isPaused = true
    console.log('[Coordinator] PAUSED:', reason)

    await query(
      `INSERT INTO infrastructure_events (event_type, details)
      VALUES ($1, $2)`,
      ['system_paused', JSON.stringify({ reason, timestamp: new Date() })]
    )
  }

  /**
   * Resume sending
   */
  async resume(): Promise<void> {
    this.isPaused = false
    console.log('[Coordinator] RESUMED')

    await query(
      `INSERT INTO infrastructure_events (event_type, details)
      VALUES ($1, $2)`,
      ['system_resumed', JSON.stringify({ timestamp: new Date() })]
    )
  }
}

// Export singleton
export const coordinator = new InfrastructureCoordinator()

// Auto-initialize on import
coordinator.initialize().catch(console.error)
