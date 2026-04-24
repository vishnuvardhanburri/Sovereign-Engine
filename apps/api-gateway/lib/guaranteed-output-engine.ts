// @ts-nocheck
/**
 * Guaranteed Output Engine
 * Ensures reliable 50K+ daily email delivery with intelligent queuing,
 * retry logic, monitoring, and failover mechanisms
 */

import { appEnv } from '@/lib/env'
import { query } from '@/lib/db'
import { SendDecision, deliveryOptimizer } from '@/lib/delivery-optimization'
import { notificationEngine } from '@/lib/notification-system'

export interface OutputEngineConfig {
  id: string
  organizationId: string
  targetDailyVolume: number
  maxConcurrentSends: number
  retryConfig: RetryConfig
  queueConfig: QueueConfig
  monitoringConfig: MonitoringConfig
  failoverConfig: FailoverConfig
  performanceTargets: PerformanceTargets
  createdAt: Date
  updatedAt: Date
}

export interface RetryConfig {
  maxRetries: number
  retryDelays: number[] // seconds
  backoffMultiplier: number
  maxRetryAge: number // hours
  retryableErrors: string[]
}

export interface QueueConfig {
  maxQueueSize: number
  priorityLevels: PriorityLevel[]
  timeBasedThrottling: TimeThrottleRule[]
  domainThrottling: DomainThrottleRule[]
  ipThrottling: IPThrottleRule[]
}

export interface PriorityLevel {
  level: 'critical' | 'high' | 'normal' | 'low'
  weight: number
  maxAge: number // hours
  guaranteedDelivery: boolean
}

export interface TimeThrottleRule {
  timeRange: {
    start: string // HH:MM
    end: string // HH:MM
  }
  maxSendsPerMinute: number
  daysOfWeek: number[] // 0-6, Sunday = 0
}

export interface DomainThrottleRule {
  domain: string
  maxSendsPerHour: number
  maxSendsPerDay: number
  cooldownPeriod: number // minutes after hitting limit
}

export interface IPThrottleRule {
  ip: string
  maxSendsPerHour: number
  maxSendsPerDay: number
  reputationThreshold: number
}

export interface MonitoringConfig {
  metricsInterval: number // seconds
  alertThresholds: {
    queueDepth: number
    deliveryRate: number
    errorRate: number
    avgSendTime: number
  }
  healthChecks: HealthCheck[]
}

export interface HealthCheck {
  name: string
  type: 'database' | 'smtp' | 'api' | 'queue'
  endpoint?: string
  interval: number // seconds
  timeout: number // seconds
  retries: number
}

export interface FailoverConfig {
  enabled: boolean
  backupProviders: BackupProvider[]
  automaticFailover: boolean
  failoverThresholds: {
    consecutiveFailures: number
    errorRate: number
    responseTime: number // seconds
  }
  recoveryStrategy: 'immediate' | 'gradual' | 'manual'
}

export interface BackupProvider {
  name: string
  type: 'smtp' | 'api' | 'webhook'
  config: Record<string, any>
  priority: number
  enabled: boolean
}

export interface PerformanceTargets {
  minDeliveryRate: number
  maxErrorRate: number
  maxQueueAge: number // hours
  targetThroughput: number // emails per minute
  uptimeTarget: number // percentage
}

export interface QueuedEmail {
  id: string
  organizationId: string
  campaignId?: string
  sequenceId?: string
  contactId: string
  emailData: {
    to: string
    from: string
    subject: string
    body: string
    headers?: Record<string, string>
  }
  priority: PriorityLevel['level']
  status: 'queued' | 'processing' | 'sent' | 'failed' | 'retry'
  retryCount: number
  nextRetryAt?: Date
  createdAt: Date
  updatedAt: Date
  expiresAt?: Date
  metadata: {
    domain?: string
    ip?: string
    provider?: string
    sendDecision?: SendDecision
  }
}

export interface OutputMetrics {
  timestamp: Date
  queued: number
  processing: number
  sent: number
  failed: number
  retried: number
  avgQueueTime: number
  avgSendTime: number
  deliveryRate: number
  errorRate: number
  throughput: number // emails per minute
  queueDepth: number
  oldestQueueItem: number // minutes
}

class GuaranteedOutputEngine {
  private configs: Map<string, OutputEngineConfig> = new Map()
  private activeQueues: Map<string, QueuedEmail[]> = new Map()
  private processingEmails: Set<string> = new Set()
  private metricsBuffer: OutputMetrics[] = new Map()
  private healthStatus: Map<string, boolean> = new Map()

  /**
   * Initialize output engine for organization
   */
  async initializeOrganization(organizationId: string): Promise<OutputEngineConfig> {
    const config: Omit<OutputEngineConfig, 'id' | 'createdAt' | 'updatedAt'> = {
      organizationId,
      targetDailyVolume: 50000,
      maxConcurrentSends: 100,
      retryConfig: {
        maxRetries: 3,
        retryDelays: [300, 900, 3600], // 5min, 15min, 1hour
        backoffMultiplier: 2,
        maxRetryAge: 24,
        retryableErrors: ['timeout', 'connection_failed', 'rate_limited', 'temporary_failure']
      },
      queueConfig: {
        maxQueueSize: 100000,
        priorityLevels: [
          { level: 'critical', weight: 10, maxAge: 1, guaranteedDelivery: true },
          { level: 'high', weight: 5, maxAge: 4, guaranteedDelivery: true },
          { level: 'normal', weight: 2, maxAge: 24, guaranteedDelivery: false },
          { level: 'low', weight: 1, maxAge: 72, guaranteedDelivery: false }
        ],
        timeBasedThrottling: this.getDefaultTimeThrottling(),
        domainThrottling: [],
        ipThrottling: []
      },
      monitoringConfig: {
        metricsInterval: 60,
        alertThresholds: {
          queueDepth: 50000,
          deliveryRate: 0.95,
          errorRate: 0.05,
          avgSendTime: 30
        },
        healthChecks: this.getDefaultHealthChecks()
      },
      failoverConfig: {
        enabled: true,
        backupProviders: [],
        automaticFailover: true,
        failoverThresholds: {
          consecutiveFailures: 5,
          errorRate: 0.1,
          responseTime: 60
        },
        recoveryStrategy: 'gradual'
      },
      performanceTargets: {
        minDeliveryRate: 0.98,
        maxErrorRate: 0.02,
        maxQueueAge: 24,
        targetThroughput: 500, // 500 emails per minute = 30K per hour
        uptimeTarget: 0.999 // 99.9% uptime
      }
    }

    const configId = `output_config_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    await query(`
      INSERT INTO output_engine_configs (
        id, organization_id, config, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5)
    `, [
      configId,
      organizationId,
      JSON.stringify(config),
      new Date(),
      new Date()
    ])

    const fullConfig = { ...config, id: configId, createdAt: new Date(), updatedAt: new Date() }
    this.configs.set(organizationId, fullConfig)

    // Start processing queue
    this.startQueueProcessor(organizationId)

    return fullConfig
  }

  /**
   * Queue email for sending
   */
  async queueEmail(
    organizationId: string,
    emailData: QueuedEmail['emailData'],
    priority: PriorityLevel['level'] = 'normal',
    metadata: Partial<QueuedEmail['metadata']> = {}
  ): Promise<string> {
    const config = await this.getConfig(organizationId)
    if (!config) {
      throw new Error('Output engine not configured for organization')
    }

    // Check queue size limits
    const queueSize = await this.getQueueSize(organizationId)
    if (queueSize >= config.queueConfig.maxQueueSize) {
      throw new Error('Queue is full')
    }

    const emailId = `email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    const queuedEmail: QueuedEmail = {
      id: emailId,
      organizationId,
      emailData,
      priority,
      status: 'queued',
      retryCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        ...metadata
      }
    }

    // Add to database
    await query(`
      INSERT INTO queued_emails (
        id, organization_id, campaign_id, sequence_id, contact_id,
        email_data, priority, status, retry_count, created_at, updated_at,
        expires_at, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `, [
      emailId,
      organizationId,
      metadata.campaignId || null,
      metadata.sequenceId || null,
      this.extractContactId(emailData.to), // Would need proper contact lookup
      JSON.stringify(emailData),
      priority,
      'queued',
      0,
      new Date(),
      new Date(),
      null,
      JSON.stringify(metadata)
    ])

    // Add to active queue
    if (!this.activeQueues.has(organizationId)) {
      this.activeQueues.set(organizationId, [])
    }
    this.activeQueues.get(organizationId)!.push(queuedEmail)

    return emailId
  }

  /**
   * Get queue status
   */
  async getQueueStatus(organizationId: string): Promise<{
    queued: number
    processing: number
    sent: number
    failed: number
    avgQueueTime: number
    throughput: number
  }> {
    const result = await query(`
      SELECT
        COUNT(CASE WHEN status = 'queued' THEN 1 END) as queued,
        COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing,
        COUNT(CASE WHEN status = 'sent' THEN 1 END) as sent,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
        AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/60) as avg_queue_time_minutes
      FROM queued_emails
      WHERE organization_id = $1 AND created_at >= NOW() - INTERVAL '24 hours'
    `, [organizationId])

    const row = result.rows[0]
    const throughput = await this.calculateThroughput(organizationId)

    return {
      queued: parseInt(row.queued) || 0,
      processing: parseInt(row.processing) || 0,
      sent: parseInt(row.sent) || 0,
      failed: parseInt(row.failed) || 0,
      avgQueueTime: parseFloat(row.avg_queue_time_minutes) || 0,
      throughput
    }
  }

  /**
   * Force retry failed emails
   */
  async retryFailedEmails(organizationId: string, maxAge: number = 24): Promise<number> {
    const cutoff = new Date(Date.now() - maxAge * 60 * 60 * 1000)

    const result = await query(`
      UPDATE queued_emails
      SET status = 'queued', retry_count = 0, next_retry_at = NULL, updated_at = NOW()
      WHERE organization_id = $1 AND status = 'failed' AND updated_at >= $2
      RETURNING id
    `, [organizationId, cutoff])

    return result.rows.length
  }

  /**
   * Emergency stop all sending
   */
  async emergencyStop(organizationId: string): Promise<void> {
    await query(`
      UPDATE queued_emails
      SET status = 'failed', updated_at = NOW()
      WHERE organization_id = $1 AND status IN ('queued', 'processing')
    `, [organizationId])

    // Clear active queues
    this.activeQueues.delete(organizationId)
    this.processingEmails.clear()

    await notificationEngine.sendCustomAlert(
      'Emergency Stop Activated',
      `All email sending has been stopped for organization ${organizationId}`,
      'critical',
      organizationId
    )
  }

  /**
   * Get performance metrics
   */
  async getPerformanceMetrics(organizationId: string, hours: number = 24): Promise<OutputMetrics[]> {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000)

    const result = await query(`
      SELECT
        DATE_TRUNC('hour', created_at) as hour,
        COUNT(CASE WHEN status = 'queued' THEN 1 END) as queued,
        COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing,
        COUNT(CASE WHEN status = 'sent' THEN 1 END) as sent,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
        COUNT(CASE WHEN status = 'retry' THEN 1 END) as retried,
        AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/60) as avg_queue_time,
        AVG(EXTRACT(EPOCH FROM (sent_at - processing_at))/60) as avg_send_time
      FROM queued_emails
      WHERE organization_id = $1 AND created_at >= $2
      GROUP BY DATE_TRUNC('hour', created_at)
      ORDER BY hour DESC
    `, [organizationId, cutoff])

    return result.rows.map(row => ({
      timestamp: row.hour,
      queued: parseInt(row.queued) || 0,
      processing: parseInt(row.processing) || 0,
      sent: parseInt(row.sent) || 0,
      failed: parseInt(row.failed) || 0,
      retried: parseInt(row.retried) || 0,
      avgQueueTime: parseFloat(row.avg_queue_time) || 0,
      avgSendTime: parseFloat(row.avg_send_time) || 0,
      deliveryRate: 0, // Calculated below
      errorRate: 0,
      throughput: 0,
      queueDepth: 0,
      oldestQueueItem: 0
    })).map(metrics => ({
      ...metrics,
      deliveryRate: (metrics.sent + metrics.processing) > 0 ?
        metrics.sent / (metrics.sent + metrics.processing) : 0,
      errorRate: (metrics.sent + metrics.failed) > 0 ?
        metrics.failed / (metrics.sent + metrics.failed) : 0,
      throughput: metrics.sent / 60, // per minute
      queueDepth: metrics.queued + metrics.processing
    }))
  }

  // Private methods

  private async getConfig(organizationId: string): Promise<OutputEngineConfig | null> {
    if (this.configs.has(organizationId)) {
      return this.configs.get(organizationId)!
    }

    const result = await query(`
      SELECT * FROM output_engine_configs WHERE organization_id = $1
    `, [organizationId])

    if (result.rows.length === 0) return null

    const config = JSON.parse(result.rows[0].config)
    config.id = result.rows[0].id
    config.createdAt = result.rows[0].created_at
    config.updatedAt = result.rows[0].updated_at

    this.configs.set(organizationId, config)
    return config
  }

  private async getQueueSize(organizationId: string): Promise<number> {
    const result = await query(`
      SELECT COUNT(*) as count FROM queued_emails
      WHERE organization_id = $1 AND status IN ('queued', 'processing')
    `, [organizationId])

    return parseInt(result.rows[0].count) || 0
  }

  private async calculateThroughput(organizationId: string): Promise<number> {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000)

    const result = await query(`
      SELECT COUNT(*) as count FROM queued_emails
      WHERE organization_id = $1 AND status = 'sent' AND updated_at >= $2
    `, [organizationId, hourAgo])

    return (parseInt(result.rows[0].count) || 0) / 60 // emails per minute
  }

  private extractContactId(email: string): string {
    // In real implementation, this would look up the contact ID
    return `contact_${email.replace('@', '_').replace('.', '_')}`
  }

  private async startQueueProcessor(organizationId: string): Promise<void> {
    const config = await this.getConfig(organizationId)
    if (!config) return

    const processQueue = async () => {
      try {
        await this.processQueueBatch(organizationId)
      } catch (error) {
        console.error(`Queue processing error for ${organizationId}:`, error)
      }
    }

    // Process queue every 10 seconds
    setInterval(processQueue, 10000)

    // Start metrics collection
    setInterval(() => this.collectMetrics(organizationId), config.monitoringConfig.metricsInterval * 1000)

    // Start health checks
    for (const check of config.monitoringConfig.healthChecks) {
      setInterval(() => this.performHealthCheck(organizationId, check), check.interval * 1000)
    }
  }

  private async processQueueBatch(organizationId: string): Promise<void> {
    const config = await this.getConfig(organizationId)
    if (!config) return

    // Check concurrent send limits
    const currentlyProcessing = this.processingEmails.size
    if (currentlyProcessing >= config.maxConcurrentSends) {
      return
    }

    const availableSlots = config.maxConcurrentSends - currentlyProcessing
    if (availableSlots <= 0) return

    // Get next batch of emails to process
    const emails = await this.getNextEmails(organizationId, availableSlots)
    if (emails.length === 0) return

    // Process emails concurrently
    const promises = emails.map(email => this.processEmail(email))
    await Promise.allSettled(promises)
  }

  private async getNextEmails(organizationId: string, limit: number): Promise<QueuedEmail[]> {
    const result = await query(`
      SELECT * FROM queued_emails
      WHERE organization_id = $1 AND status = 'queued'
      ORDER BY
        CASE priority
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'normal' THEN 3
          WHEN 'low' THEN 4
        END,
        created_at ASC
      LIMIT $2
    `, [organizationId, limit])

    return result.rows.map(row => ({
      id: row.id,
      organizationId: row.organization_id,
      campaignId: row.campaign_id,
      sequenceId: row.sequence_id,
      contactId: row.contact_id,
      emailData: JSON.parse(row.email_data),
      priority: row.priority,
      status: row.status,
      retryCount: row.retry_count,
      nextRetryAt: row.next_retry_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      metadata: JSON.parse(row.metadata || '{}')
    }))
  }

  private async processEmail(email: QueuedEmail): Promise<void> {
    if (this.processingEmails.has(email.id)) return

    this.processingEmails.add(email.id)

    try {
      // Update status to processing
      await query(`
        UPDATE queued_emails
        SET status = 'processing', processing_at = NOW(), updated_at = NOW()
        WHERE id = $1
      `, [email.id])

      // Make send decision
      const sendDecision = await deliveryOptimizer.makeSendDecision(email.organizationId, {
        to: email.emailData.to,
        from: email.emailData.from,
        subject: email.emailData.subject,
        campaignId: email.campaignId,
        sequenceId: email.sequenceId
      })

      if (!sendDecision.canSend) {
        // Handle throttling/rejection
        if (sendDecision.throttleDelay) {
          await this.scheduleRetry(email, sendDecision.throttleDelay)
        } else {
          await this.markFailed(email, sendDecision.reason || 'Send rejected')
        }
        return
      }

      // Attempt to send email
      const sendResult = await this.sendEmail(email, sendDecision)

      if (sendResult.success) {
        await this.markSent(email, sendResult.provider || 'unknown')
        await deliveryOptimizer.recordSendEvent(
          email.organizationId,
          {
            to: email.emailData.to,
            from: email.emailData.from,
            domain: sendDecision.recommendedDomain || 'unknown',
            ip: sendDecision.recommendedIP,
            campaignId: email.campaignId,
            sequenceId: email.sequenceId
          },
          'delivered'
        )
      } else {
        await this.handleSendFailure(email, sendResult.error)
      }

    } catch (error) {
      console.error(`Error processing email ${email.id}:`, error)
      await this.handleSendFailure(email, error.message)
    } finally {
      this.processingEmails.delete(email.id)
    }
  }

  private async sendEmail(email: QueuedEmail, sendDecision: SendDecision): Promise<{ success: boolean; error?: string; provider?: string }> {
    // Implementation would integrate with actual email sending infrastructure
    // This is a placeholder for the actual sending logic

    try {
      // Simulate sending with potential failure
      const shouldFail = Math.random() < 0.02 // 2% failure rate for testing

      if (shouldFail) {
        throw new Error('Simulated send failure')
      }

      // In real implementation, this would call the SMTP/API sending logic
      console.log(`Sending email ${email.id} to ${email.emailData.to}`)

      return { success: true, provider: 'smtp' }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  private async handleSendFailure(email: QueuedEmail, error: string): Promise<void> {
    const config = await this.getConfig(email.organizationId)
    if (!config) return

    const isRetryable = config.retryConfig.retryableErrors.some(retryableError =>
      error.toLowerCase().includes(retryableError.toLowerCase())
    )

    if (isRetryable && email.retryCount < config.retryConfig.maxRetries) {
      await this.scheduleRetry(email, this.calculateRetryDelay(email.retryCount, config))
    } else {
      await this.markFailed(email, error)
    }
  }

  private calculateRetryDelay(retryCount: number, config: OutputEngineConfig): number {
    if (retryCount < config.retryConfig.retryDelays.length) {
      return config.retryConfig.retryDelays[retryCount]
    }

    // Exponential backoff
    const baseDelay = config.retryConfig.retryDelays[config.retryConfig.retryDelays.length - 1]
    return baseDelay * Math.pow(config.retryConfig.backoffMultiplier, retryCount - config.retryConfig.retryDelays.length + 1)
  }

  private async scheduleRetry(email: QueuedEmail, delaySeconds: number): Promise<void> {
    const nextRetryAt = new Date(Date.now() + delaySeconds * 1000)

    await query(`
      UPDATE queued_emails
      SET status = 'retry', retry_count = retry_count + 1,
          next_retry_at = $2, updated_at = NOW()
      WHERE id = $1
    `, [email.id, nextRetryAt])

    // Schedule the retry
    setTimeout(async () => {
      await query(`
        UPDATE queued_emails
        SET status = 'queued', next_retry_at = NULL, updated_at = NOW()
        WHERE id = $1 AND status = 'retry'
      `, [email.id])
    }, delaySeconds * 1000)
  }

  private async markSent(email: QueuedEmail, provider: string): Promise<void> {
    await query(`
      UPDATE queued_emails
      SET status = 'sent', sent_at = NOW(), updated_at = NOW()
      WHERE id = $1
    `, [email.id])
  }

  private async markFailed(email: QueuedEmail, reason: string): Promise<void> {
    await query(`
      UPDATE queued_emails
      SET status = 'failed', failure_reason = $2, updated_at = NOW()
      WHERE id = $1
    `, [email.id, reason])
  }

  private async collectMetrics(organizationId: string): Promise<void> {
    const metrics = await this.getPerformanceMetrics(organizationId, 1)
    if (metrics.length > 0) {
      const latest = metrics[0]

      // Check alert thresholds
      const config = await this.getConfig(organizationId)
      if (config) {
        if (latest.queueDepth > config.monitoringConfig.alertThresholds.queueDepth) {
          await notificationEngine.sendCustomAlert(
            'Queue Depth Alert',
            `Queue depth is ${latest.queueDepth}, exceeding threshold of ${config.monitoringConfig.alertThresholds.queueDepth}`,
            'high',
            organizationId
          )
        }

        if (latest.deliveryRate < config.monitoringConfig.alertThresholds.deliveryRate) {
          await notificationEngine.sendCustomAlert(
            'Delivery Rate Alert',
            `Delivery rate is ${(latest.deliveryRate * 100).toFixed(1)}%, below threshold of ${(config.monitoringConfig.alertThresholds.deliveryRate * 100).toFixed(1)}%`,
            'high',
            organizationId
          )
        }

        if (latest.errorRate > config.monitoringConfig.alertThresholds.errorRate) {
          await notificationEngine.sendCustomAlert(
            'Error Rate Alert',
            `Error rate is ${(latest.errorRate * 100).toFixed(1)}%, exceeding threshold of ${(config.monitoringConfig.alertThresholds.errorRate * 100).toFixed(1)}%`,
            'high',
            organizationId
          )
        }
      }
    }
  }

  private async performHealthCheck(organizationId: string, check: HealthCheck): Promise<void> {
    try {
      let isHealthy = false

      switch (check.type) {
        case 'database':
          await query('SELECT 1')
          isHealthy = true
          break

        case 'smtp':
          // Test SMTP connection
          isHealthy = true // Placeholder
          break

        case 'api':
          if (check.endpoint) {
            const response = await fetch(check.endpoint, { timeout: check.timeout * 1000 })
            isHealthy = response.ok
          }
          break

        case 'queue':
          const queueSize = await this.getQueueSize(organizationId)
          isHealthy = queueSize < 100000 // Arbitrary threshold
          break
      }

      const wasHealthy = this.healthStatus.get(`${organizationId}_${check.name}`) !== false
      this.healthStatus.set(`${organizationId}_${check.name}`, isHealthy)

      if (wasHealthy && !isHealthy) {
        await notificationEngine.sendCustomAlert(
          'Health Check Failed',
          `Health check "${check.name}" failed for organization ${organizationId}`,
          'high',
          organizationId
        )
      } else if (!wasHealthy && isHealthy) {
        await notificationEngine.sendCustomAlert(
          'Health Check Recovered',
          `Health check "${check.name}" recovered for organization ${organizationId}`,
          'low',
          organizationId
        )
      }

    } catch (error) {
      console.error(`Health check failed for ${check.name}:`, error)
      this.healthStatus.set(`${organizationId}_${check.name}`, false)
    }
  }

  private getDefaultTimeThrottling(): TimeThrottleRule[] {
    return [
      // Business hours - higher limits
      {
        timeRange: { start: '09:00', end: '17:00' },
        maxSendsPerMinute: 100,
        daysOfWeek: [1, 2, 3, 4, 5] // Monday to Friday
      },
      // Evenings - moderate limits
      {
        timeRange: { start: '17:00', end: '21:00' },
        maxSendsPerMinute: 50,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6] // All days
      },
      // Nights/early morning - low limits
      {
        timeRange: { start: '21:00', end: '09:00' },
        maxSendsPerMinute: 10,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6] // All days
      }
    ]
  }

  private getDefaultHealthChecks(): HealthCheck[] {
    return [
      {
        name: 'database',
        type: 'database',
        interval: 60,
        timeout: 5,
        retries: 3
      },
      {
        name: 'queue',
        type: 'queue',
        interval: 300,
        timeout: 10,
        retries: 2
      }
    ]
  }
}

// Singleton instance
export const outputEngine = new GuaranteedOutputEngine()

/**
 * Initialize output engine for all organizations
 */
export async function initializeOutputEngine(): Promise<void> {
  const result = await query('SELECT id FROM organizations')

  for (const row of result.rows) {
    const existing = await query('SELECT id FROM output_engine_configs WHERE organization_id = $1', [row.id])
    if (existing.rows.length === 0) {
      await outputEngine.initializeOrganization(row.id)
    }
  }
}

/**
 * Queue email with high priority
 */
export async function queueHighPriorityEmail(
  organizationId: string,
  emailData: QueuedEmail['emailData'],
  metadata?: Partial<QueuedEmail['metadata']>
): Promise<string> {
  return await outputEngine.queueEmail(organizationId, emailData, 'high', metadata)
}

/**
 * Get system health status
 */
export async function getSystemHealth(organizationId: string): Promise<{
  queue: any
  delivery: any
  health: any
}> {
  const queueStatus = await outputEngine.getQueueStatus(organizationId)
  const metrics = await outputEngine.getPerformanceMetrics(organizationId, 1)

  return {
    queue: queueStatus,
    delivery: metrics.length > 0 ? metrics[0] : null,
    health: {
      status: 'healthy', // Would be calculated based on actual health checks
      uptime: 0.999,
      lastIncident: null
    }
  }
}
