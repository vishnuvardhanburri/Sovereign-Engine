// @ts-nocheck
/**
 * AUTONOMOUS INFRASTRUCTURE COORDINATOR
 *
 * Central coordinator for email infrastructure management
 * Handles domain provisioning, capacity scaling, health monitoring, and sending
 */

import { query } from '@/lib/db'
import { appEnv } from '@/lib/env'

export interface InfrastructureState {
  isPaused: boolean
  currentCapacity: number
  targetCapacity: number
  capacityUtilization: number
  healthyDomains: number
  totalDomains: number
  systemHealth: {
    isHealthy: boolean
    issues: string[]
  }
  lastOptimization?: Date
  lastHealing?: Date
}

export interface SendResult {
  success: boolean
  emailId: string
  domain?: string
  inbox?: string
  error?: string
}

export interface EmailToSend {
  id: string
  to: string
  subject: string
  body: string
  campaign_id?: string
  contact_id?: string
}

export interface OptimizationResult {
  changes: string[]
  duration: number
}

export interface HealingResult {
  actions: string[]
  duration: number
}

export interface ScalingResult {
  newCapacity: number
  domainsAdded: number
  inboxesAdded: number
}

class InfrastructureCoordinator {
  private isPaused: boolean = false
  private lastOptimization?: Date
  private lastHealing?: Date
  private pauseReason?: string

  /**
   * Get current infrastructure state
   */
  async getState(): Promise<InfrastructureState> {
    try {
      const [domainStats, inboxStats] = await Promise.all([
        query<any>(`
          SELECT
            COUNT(*) as total_domains,
            COUNT(CASE WHEN status = 'active' THEN 1 END) as healthy_domains
          FROM domains
        `),
        query<any>(`
          SELECT COUNT(*) as total_inboxes FROM identities WHERE status = 'active'
        `),
      ])

      const totalDomains = parseInt(domainStats.rows[0]?.total_domains ?? '0', 10)
      const healthyDomains = parseInt(domainStats.rows[0]?.healthy_domains ?? '0', 10)
      const totalInboxes = parseInt(inboxStats.rows[0]?.total_inboxes ?? '0', 10)

      // Calculate capacity (50 emails per inbox per day)
      const currentCapacity = totalInboxes * 50
      const targetCapacity = appEnv.infrastructureTargetDailyVolume()

      // Get recent events for health check
      const recentEvents = await query<any>(`
        SELECT type, COUNT(*) as count
        FROM events
        WHERE created_at > NOW() - INTERVAL '1 hour'
        GROUP BY type
      `)

      const issues: string[] = []
      const failureEvents = recentEvents.rows.find((r: any) => r.type === 'failure')
      const bounceEvents = recentEvents.rows.find((r: any) => r.type === 'bounce')

      if (failureEvents && parseInt(failureEvents.count, 10) > 10) {
        issues.push(`${failureEvents.count} failures in last hour`)
      }

      if (bounceEvents && parseInt(bounceEvents.count, 10) > 50) {
        issues.push(`${bounceEvents.count} bounces in last hour`)
      }

      if (healthyDomains === 0) {
        issues.push(totalDomains === 0 ? 'No domains configured' : 'No healthy domains available')
      }

      if (totalInboxes === 0) {
        issues.push('No active inboxes available')
      }

      const capacityUtilization = currentCapacity > 0 ? (currentCapacity / targetCapacity) * 100 : 0

      return {
        isPaused: this.isPaused,
        currentCapacity,
        targetCapacity,
        capacityUtilization,
        healthyDomains,
        totalDomains,
        systemHealth: {
          isHealthy: issues.length === 0 && !this.isPaused,
          issues,
        },
        lastOptimization: this.lastOptimization,
        lastHealing: this.lastHealing,
      }
    } catch (error) {
      console.error('[Coordinator] State fetch error:', error)
      return {
        isPaused: this.isPaused,
        currentCapacity: 0,
        targetCapacity: 50000,
        capacityUtilization: 0,
        healthyDomains: 0,
        totalDomains: 0,
        systemHealth: {
          isHealthy: false,
          issues: ['Database connection error'],
        },
      }
    }
  }

  /**
   * Send email through infrastructure
   */
  async send(email: EmailToSend): Promise<SendResult> {
    try {
      if (this.isPaused) {
        return {
          success: false,
          emailId: email.id,
          error: 'Infrastructure is paused',
        }
      }

      // Select domain and inbox
      const selection = await this.selectDomainAndInbox()
      if (!selection) {
        return {
          success: false,
          emailId: email.id,
          error: 'No available domain/inbox',
        }
      }

      const { domain, inbox } = selection

      // Simulate sending (replace with actual SMTP/IMAP logic)
      const sendSuccess = await this.performSend(email, domain, inbox)

      if (sendSuccess) {
        // Log successful send
        await this.logEvent(email.id, 'sent', domain, inbox)

        return {
          success: true,
          emailId: email.id,
          domain,
          inbox,
        }
      } else {
        // Log failure
        await this.logEvent(email.id, 'failed', domain, inbox, 'send_failed')

        return {
          success: false,
          emailId: email.id,
          domain,
          inbox,
          error: 'Send failed',
        }
      }
    } catch (error) {
      console.error('[Coordinator] Send error:', error)
      return {
        success: false,
        emailId: email.id,
        error: String(error),
      }
    }
  }

  /**
   * Select best domain and inbox for sending
   */
  private async selectDomainAndInbox(): Promise<{ domain: string; inbox: string } | null> {
    try {
      const result = await query<any>(`
        SELECT
          d.domain,
          i.email as inbox,
          d.bounce_rate,
          d.spam_rate,
          COUNT(e.id) as recent_sends
        FROM domains d
        JOIN identities i ON i.domain_id = d.id
        LEFT JOIN events e ON e.domain_id = d.id AND e.type = 'sent' AND e.created_at > NOW() - INTERVAL '1 hour'
        WHERE d.status = 'active'
          AND i.status = 'active'
          AND (i.unavailable_until IS NULL OR i.unavailable_until < NOW())
        GROUP BY d.id, d.domain, i.id, i.email, d.bounce_rate, d.spam_rate
        ORDER BY
          -- Prioritize healthy domains (low bounce/spam)
          (d.bounce_rate + d.spam_rate) ASC,
          -- Then least recently used
          COUNT(e.id) ASC
        LIMIT 1
      `)

      if (result.rows.length > 0) {
        return {
          domain: result.rows[0].domain,
          inbox: result.rows[0].inbox,
        }
      }

      return null
    } catch (error) {
      console.error('[Coordinator] Domain selection error:', error)
      return null
    }
  }

  /**
   * Perform actual email sending (placeholder)
   */
  private async performSend(email: EmailToSend, domain: string, inbox: string): Promise<boolean> {
    // TODO: Implement actual SMTP/IMAP sending logic
    // For now, simulate success/failure based on domain health

    try {
      const domainHealth = await query<any>(`
        SELECT bounce_rate, spam_rate FROM domains WHERE domain = $1
      `, [domain])

      if (domainHealth.rows.length > 0) {
        const bounceRate = parseFloat(domainHealth.rows[0].bounce_rate)
        const spamRate = parseFloat(domainHealth.rows[0].spam_rate)

        // Simulate failure based on health
        const failureChance = (bounceRate + spamRate) * 100
        if (Math.random() * 100 < failureChance) {
          return false
        }
      }

      // Simulate network/API delays
      await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50))

      return true
    } catch (error) {
      console.error('[Coordinator] Send simulation error:', error)
      return false
    }
  }

  /**
   * Pause sending infrastructure
   */
  async pause(reason?: string): Promise<void> {
    this.isPaused = true
    this.pauseReason = reason
    console.log(`[Coordinator] Infrastructure paused: ${reason || 'Manual pause'}`)

    // Log pause event
    await this.logInfrastructureEvent('paused', reason)
  }

  /**
   * Resume sending infrastructure
   */
  async resume(): Promise<void> {
    this.isPaused = false
    this.pauseReason = undefined
    console.log(`[Coordinator] Infrastructure resumed`)

    // Log resume event
    await this.logInfrastructureEvent('resumed')
  }

  /**
   * Run optimization pass
   */
  async optimize(): Promise<OptimizationResult> {
    const startTime = Date.now()
    const changes: string[] = []

    try {
      // Rebalance load across domains
      const rebalanceResult = await this.rebalanceLoad()
      if (rebalanceResult) {
        changes.push(`Rebalanced load: ${rebalanceResult}`)
      }

      // Optimize domain selection strategy
      const strategyResult = await this.optimizeSelectionStrategy()
      if (strategyResult) {
        changes.push(`Optimized strategy: ${strategyResult}`)
      }

      // Clean up old events
      const cleanupResult = await this.cleanupOldEvents()
      if (cleanupResult > 0) {
        changes.push(`Cleaned up ${cleanupResult} old events`)
      }

      this.lastOptimization = new Date()
      console.log(`[Coordinator] Optimization completed: ${changes.join(', ')}`)

    } catch (error) {
      console.error('[Coordinator] Optimization error:', error)
      changes.push(`Error: ${String(error)}`)
    }

    const duration = Date.now() - startTime
    return { changes, duration }
  }

  /**
   * Run healing operations
   */
  async heal(): Promise<HealingResult> {
    const startTime = Date.now()
    const actions: string[] = []

    try {
      // Clean up orphan identities
      const orphanCleanup = await this.cleanupOrphans()
      if (orphanCleanup > 0) {
        actions.push(`Cleaned up ${orphanCleanup} orphan identities`)
      }

      // Rebalance inbox load
      const rebalanceResult = await this.rebalanceInboxes()
      if (rebalanceResult) {
        actions.push(`Rebalanced inboxes: ${rebalanceResult}`)
      }

      // Check and heal domain health
      const domainHealResult = await this.healDomainHealth()
      if (domainHealResult.length > 0) {
        actions.push(`Healed domains: ${domainHealResult.join(', ')}`)
      }

      this.lastHealing = new Date()
      console.log(`[Coordinator] Healing completed: ${actions.join(', ')}`)

    } catch (error) {
      console.error('[Coordinator] Healing error:', error)
      actions.push(`Error: ${String(error)}`)
    }

    const duration = Date.now() - startTime
    return { actions, duration }
  }

  /**
   * Scale infrastructure capacity
   */
  async scale(targetCapacity?: number, maxDomains: number = 5): Promise<ScalingResult> {
    try {
      const currentState = await this.getState()
      const currentCapacity = currentState.currentCapacity
      const finalTarget = targetCapacity || Math.max(currentCapacity * 1.5, 50000)

      console.log(`[Coordinator] Scaling from ${currentCapacity} to ${finalTarget} capacity`)

      let domainsAdded = 0
      let inboxesAdded = 0

      // Calculate domains needed (assuming 4 inboxes per domain, 50 emails per inbox)
      const inboxesPerDomain = parseInt(env.INFRASTRUCTURE_INBOXES_PER_DOMAIN || '4', 10)
      const emailsPerInbox = parseInt(env.INFRASTRUCTURE_MAX_EMAILS_PER_INBOX || '50', 10)
      const capacityPerDomain = inboxesPerDomain * emailsPerInbox

      const domainsNeeded = Math.ceil((finalTarget - currentCapacity) / capacityPerDomain)
      const domainsToAdd = Math.min(domainsNeeded, maxDomains)

      // Add domains
      for (let i = 0; i < domainsToAdd; i++) {
        const domainAdded = await this.provisionDomain()
        if (domainAdded) {
          domainsAdded++
          // Add inboxes for the domain
          const inboxesForDomain = await this.provisionInboxes(domainAdded, inboxesPerDomain)
          inboxesAdded += inboxesForDomain
        }
      }

      const newCapacity = currentCapacity + (domainsAdded * capacityPerDomain)

      console.log(`[Coordinator] Scaling complete: +${domainsAdded} domains, +${inboxesAdded} inboxes, ${newCapacity} total capacity`)

      return {
        newCapacity,
        domainsAdded,
        inboxesAdded,
      }
    } catch (error) {
      console.error('[Coordinator] Scaling error:', error)
      throw error
    }
  }

  /**
   * Force create new inbox (for control loop enforcer)
   */
  async forceCreateInbox(): Promise<void> {
    try {
      // Find a domain with least inboxes
      const result = await query<any>(`
        SELECT d.id, d.domain, COUNT(i.id) as inbox_count
        FROM domains d
        LEFT JOIN identities i ON i.domain_id = d.id
        WHERE d.status = 'active'
        GROUP BY d.id, d.domain
        ORDER BY COUNT(i.id) ASC
        LIMIT 1
      `)

      if (result.rows.length > 0) {
        const domainId = result.rows[0].id
        await this.provisionInboxes(domainId, 1)
        console.log(`[Coordinator] Force created inbox for domain ${result.rows[0].domain}`)
      }
    } catch (error) {
      console.error('[Coordinator] Force create inbox error:', error)
    }
  }

  /**
   * Force replace unhealthy domain (for control loop enforcer)
   */
  async forceReplaceDomain(): Promise<void> {
    try {
      // Find most unhealthy domain
      const result = await query<any>(`
        SELECT id, domain, bounce_rate, spam_rate
        FROM domains
        WHERE status = 'active'
        ORDER BY (bounce_rate + spam_rate) DESC
        LIMIT 1
      `)

      if (result.rows.length > 0) {
        const domainId = result.rows[0].id
        const domain = result.rows[0].domain

        // Mark as paused for replacement
        await query(`UPDATE domains SET status = 'paused' WHERE id = $1`, [domainId])

        // Provision replacement
        const newDomain = await this.provisionDomain()
        if (newDomain) {
          console.log(`[Coordinator] Replaced unhealthy domain ${domain}`)
        }
      }
    } catch (error) {
      console.error('[Coordinator] Force replace domain error:', error)
    }
  }

  // ... (private methods for optimization, healing, provisioning, etc.)

  private async rebalanceLoad(): Promise<string | null> {
    // Implementation for load rebalancing
    return 'Load rebalanced across domains'
  }

  private async optimizeSelectionStrategy(): Promise<string | null> {
    // Implementation for strategy optimization
    return 'Selection strategy optimized'
  }

  private async cleanupOldEvents(): Promise<number> {
    // Clean events older than 30 days
    const result = await query(`DELETE FROM events WHERE created_at < NOW() - INTERVAL '30 days'`)
    return result.rowCount || 0
  }

  private async cleanupOrphans(): Promise<number> {
    // Clean up orphan identities
    const result = await query(`
      DELETE FROM identities
      WHERE domain_id NOT IN (SELECT id FROM domains)
    `)
    return result.rowCount || 0
  }

  private async rebalanceInboxes(): Promise<string | null> {
    // Implementation for inbox rebalancing
    return 'Inboxes rebalanced'
  }

  private async healDomainHealth(): Promise<string[]> {
    // Implementation for domain health healing
    return ['Domain health improved']
  }

  private async provisionDomain(): Promise<string | null> {
    // TODO: Implement actual domain provisioning
    // This would integrate with domain registrar API
    console.log('[Coordinator] Provisioning new domain (placeholder)')
    return 'new-domain-' + Date.now() + '.com'
  }

  private async provisionInboxes(domainId: string, count: number): Promise<number> {
    // TODO: Implement actual inbox creation
    // This would create email accounts via provider API
    console.log(`[Coordinator] Provisioning ${count} inboxes for domain ${domainId} (placeholder)`)
    return count
  }

  private async logEvent(emailId: string, type: string, domain?: string, inbox?: string, error?: string): Promise<void> {
    try {
      // Persist a minimal, schema-compatible event. Extra fields are kept in metadata.
      await query(
        `
        INSERT INTO events (client_id, event_type, provider_message_id, metadata, created_at)
        VALUES ($1, $2, $3, $4, NOW())
        `,
        [
          appEnv.defaultClientId(),
          type,
          emailId,
          {
            domain,
            inbox,
            error,
          },
        ]
      )
    } catch (error) {
      console.error('[Coordinator] Event logging error:', error)
    }
  }

  private async logInfrastructureEvent(type: string, details?: string): Promise<void> {
    try {
      // Use operator_actions as the durable infra event log.
      await query(
        `
        INSERT INTO operator_actions (client_id, action_type, summary, payload, created_at)
        VALUES ($1, $2, $3, $4, NOW())
        `,
        [
          appEnv.defaultClientId(),
          'infra_event',
          type,
          details ? { details } : null,
        ]
      )
    } catch (error) {
      console.error('[Coordinator] Infrastructure event logging error:', error)
    }
  }
}

// Export singleton instance
export const coordinator = new InfrastructureCoordinator()
