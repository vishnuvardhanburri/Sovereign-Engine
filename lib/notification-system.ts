// @ts-nocheck
/**
 * Notification System
 * Alerts, Slack/email notifications, and system monitoring
 * Keeps users informed about campaign performance, system health, and critical events
 */

import { appEnv } from '@/lib/env'
import { query } from '@/lib/db'
import { TrackingAnalytics } from '@/lib/advanced-tracking'
import { ComplianceReport } from '@/lib/compliance'

export interface NotificationChannel {
  id: string
  type: 'email' | 'slack' | 'webhook' | 'sms'
  name: string
  config: {
    email?: string
    slackWebhook?: string
    webhookUrl?: string
    phoneNumber?: string
    apiKey?: string
  }
  enabled: boolean
  organizationId: string
  createdAt: Date
  updatedAt: Date
}

export interface NotificationRule {
  id: string
  name: string
  description: string
  eventType: NotificationEventType
  conditions: NotificationCondition[]
  channels: string[] // channel IDs
  enabled: boolean
  cooldownMinutes: number // prevent spam
  organizationId: string
  createdAt: Date
  updatedAt: Date
}

export interface NotificationCondition {
  field: string
  operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains' | 'in'
  value: any
  logic: 'and' | 'or'
}

export interface NotificationEvent {
  id: string
  type: NotificationEventType
  title: string
  message: string
  data: Record<string, any>
  severity: 'low' | 'medium' | 'high' | 'critical'
  organizationId: string
  userId?: string
  campaignId?: string
  sequenceId?: string
  contactId?: string
  timestamp: Date
  sent: boolean
  sentAt?: Date
  error?: string
}

export type NotificationEventType =
  // Campaign events
  | 'campaign_started'
  | 'campaign_completed'
  | 'campaign_paused'
  | 'campaign_failed'

  // Performance events
  | 'high_bounce_rate'
  | 'low_delivery_rate'
  | 'high_unsubscribe_rate'
  | 'sequence_stuck'
  | 'campaign_goal_reached'

  // Compliance events
  | 'compliance_violation'
  | 'domain_blacklisted'
  | 'spam_complaint'

  // System events
  | 'system_error'
  | 'api_rate_limit'
  | 'database_connection_issue'
  | 'email_provider_down'

  // Reply events
  | 'high_reply_rate'
  | 'important_reply'
  | 'sequence_stopped_on_reply'

  // Contact events
  | 'contact_enrichment_failed'
  | 'duplicate_contacts_found'
  | 'contact_list_import_completed'

  // A/B testing events
  | 'ab_test_completed'
  | 'ab_test_winner_selected'

  // Manual alerts
  | 'custom_alert'

export interface NotificationTemplate {
  id: string
  eventType: NotificationEventType
  subject: string
  message: string
  variables: string[] // available template variables
  organizationId: string
  createdAt: Date
  updatedAt: Date
}

export interface NotificationHistory {
  id: string
  eventId: string
  channelId: string
  status: 'sent' | 'failed' | 'pending'
  sentAt?: Date
  error?: string
  response?: any
}

class NotificationEngine {
  private templates: Map<NotificationEventType, NotificationTemplate> = new Map()

  /**
   * Initialize notification system
   */
  async initialize(): Promise<void> {
    await this.loadTemplates()
    await this.startMonitoring()
  }

  /**
   * Create notification channel
   */
  async createChannel(
    type: NotificationChannel['type'],
    name: string,
    config: NotificationChannel['config'],
    organizationId: string
  ): Promise<NotificationChannel> {
    const channelId = this.generateId('channel')

    await query(`
      INSERT INTO notification_channels (
        id, type, name, config, enabled, organization_id, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      channelId,
      type,
      name,
      JSON.stringify(config),
      true,
      organizationId,
      new Date(),
      new Date()
    ])

    return await this.getChannel(channelId)
  }

  /**
   * Create notification rule
   */
  async createRule(
    name: string,
    description: string,
    eventType: NotificationEventType,
    conditions: NotificationCondition[],
    channels: string[],
    cooldownMinutes: number,
    organizationId: string
  ): Promise<NotificationRule> {
    const ruleId = this.generateId('rule')

    await query(`
      INSERT INTO notification_rules (
        id, name, description, event_type, conditions, channels,
        enabled, cooldown_minutes, organization_id, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [
      ruleId,
      name,
      description,
      eventType,
      JSON.stringify(conditions),
      JSON.stringify(channels),
      true,
      cooldownMinutes,
      organizationId,
      new Date(),
      new Date()
    ])

    return await this.getRule(ruleId)
  }

  /**
   * Send notification
   */
  async sendNotification(
    eventType: NotificationEventType,
    data: Record<string, any>,
    organizationId: string,
    userId?: string,
    severity: NotificationEvent['severity'] = 'medium'
  ): Promise<void> {
    // Create event record
    const eventId = this.generateId('event')
    const event: NotificationEvent = {
      id: eventId,
      type: eventType,
      title: this.getEventTitle(eventType),
      message: this.getEventMessage(eventType, data),
      data,
      severity,
      organizationId,
      userId,
      campaignId: data.campaignId,
      sequenceId: data.sequenceId,
      contactId: data.contactId,
      timestamp: new Date(),
      sent: false
    }

    await query(`
      INSERT INTO notification_events (
        id, type, title, message, data, severity, organization_id,
        user_id, campaign_id, sequence_id, contact_id, timestamp, sent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `, [
      eventId,
      eventType,
      event.title,
      event.message,
      JSON.stringify(data),
      severity,
      organizationId,
      userId || null,
      data.campaignId || null,
      data.sequenceId || null,
      data.contactId || null,
      new Date(),
      false
    ])

    // Check rules and send notifications
    await this.processEvent(event)
  }

  /**
   * Send custom alert
   */
  async sendCustomAlert(
    title: string,
    message: string,
    severity: NotificationEvent['severity'],
    organizationId: string,
    channels?: string[]
  ): Promise<void> {
    await this.sendNotification('custom_alert', {
      title,
      message,
      custom: true
    }, organizationId, undefined, severity)
  }

  /**
   * Get notification channels for organization
   */
  async getChannels(organizationId: string): Promise<NotificationChannel[]> {
    const result = await query(`
      SELECT * FROM notification_channels
      WHERE organization_id = $1 AND enabled = true
      ORDER BY created_at DESC
    `, [organizationId])

    return result.rows.map(row => ({
      id: row.id,
      type: row.type,
      name: row.name,
      config: JSON.parse(row.config || '{}'),
      enabled: row.enabled,
      organizationId: row.organization_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  }

  /**
   * Get notification rules for organization
   */
  async getRules(organizationId: string): Promise<NotificationRule[]> {
    const result = await query(`
      SELECT * FROM notification_rules
      WHERE organization_id = $1 AND enabled = true
      ORDER BY created_at DESC
    `, [organizationId])

    return result.rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      eventType: row.event_type,
      conditions: JSON.parse(row.conditions || '[]'),
      channels: JSON.parse(row.channels || '[]'),
      enabled: row.enabled,
      cooldownMinutes: row.cooldown_minutes,
      organizationId: row.organization_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  }

  /**
   * Get notification history
   */
  async getNotificationHistory(
    organizationId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<NotificationEvent[]> {
    const result = await query(`
      SELECT * FROM notification_events
      WHERE organization_id = $1
      ORDER BY timestamp DESC
      LIMIT $2 OFFSET $3
    `, [organizationId, limit, offset])

    return result.rows.map(row => ({
      id: row.id,
      type: row.type,
      title: row.title,
      message: row.message,
      data: JSON.parse(row.data || '{}'),
      severity: row.severity,
      organizationId: row.organization_id,
      userId: row.user_id,
      campaignId: row.campaign_id,
      sequenceId: row.sequence_id,
      contactId: row.contact_id,
      timestamp: row.timestamp,
      sent: row.sent,
      sentAt: row.sent_at,
      error: row.error
    }))
  }

  /**
   * Test notification channel
   */
  async testChannel(channelId: string): Promise<boolean> {
    const channel = await this.getChannel(channelId)
    if (!channel) return false

    try {
      await this.sendToChannel(channel, {
        title: 'Test Notification',
        message: 'This is a test notification from your outbound sales platform.',
        severity: 'low'
      })
      return true
    } catch (error) {
      console.error('Channel test failed:', error)
      return false
    }
  }

  // Private methods

  private async loadTemplates(): Promise<void> {
    // Load default templates
    const defaultTemplates: Record<NotificationEventType, Omit<NotificationTemplate, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>> = {
      campaign_started: {
        eventType: 'campaign_started',
        subject: 'Campaign Started: {{campaignName}}',
        message: 'Your campaign "{{campaignName}}" has started successfully. {{totalContacts}} contacts will be contacted over the next {{duration}}.',
        variables: ['campaignName', 'totalContacts', 'duration']
      },
      campaign_completed: {
        eventType: 'campaign_completed',
        subject: 'Campaign Completed: {{campaignName}}',
        message: 'Campaign "{{campaignName}}" has completed. Results: {{delivered}} delivered, {{opened}} opened ({{openRate}}%), {{replied}} replied.',
        variables: ['campaignName', 'delivered', 'opened', 'openRate', 'replied']
      },
      high_bounce_rate: {
        eventType: 'high_bounce_rate',
        subject: 'High Bounce Rate Alert: {{campaignName}}',
        message: 'Campaign "{{campaignName}}" has a bounce rate of {{bounceRate}}%. This may indicate email quality issues.',
        variables: ['campaignName', 'bounceRate']
      },
      compliance_violation: {
        eventType: 'compliance_violation',
        subject: 'Compliance Violation Detected',
        message: 'A compliance violation was detected: {{violation}}. Please review and take corrective action.',
        variables: ['violation']
      },
      system_error: {
        eventType: 'system_error',
        subject: 'System Error Alert',
        message: 'A system error occurred: {{error}}. The system will attempt to recover automatically.',
        variables: ['error']
      },
      high_reply_rate: {
        eventType: 'high_reply_rate',
        subject: 'High Reply Rate: {{campaignName}}',
        message: 'Campaign "{{campaignName}}" has a reply rate of {{replyRate}}%. Consider pausing to review replies.',
        variables: ['campaignName', 'replyRate']
      },
      ab_test_completed: {
        eventType: 'ab_test_completed',
        subject: 'A/B Test Completed: {{testName}}',
        message: 'A/B test "{{testName}}" has completed. Winner: Variant {{winnerVariant}} with {{winnerMetric}}.',
        variables: ['testName', 'winnerVariant', 'winnerMetric']
      },
      custom_alert: {
        eventType: 'custom_alert',
        subject: '{{title}}',
        message: '{{message}}',
        variables: ['title', 'message']
      }
    }

    for (const [eventType, template] of Object.entries(defaultTemplates)) {
      this.templates.set(eventType as NotificationEventType, {
        id: `template_${eventType}`,
        ...template,
        organizationId: 'system',
        createdAt: new Date(),
        updatedAt: new Date()
      })
    }
  }

  private async startMonitoring(): Promise<void> {
    // Set up periodic health checks
    setInterval(() => this.performHealthChecks(), 5 * 60 * 1000) // Every 5 minutes

    // Set up performance monitoring
    setInterval(() => this.monitorPerformance(), 15 * 60 * 1000) // Every 15 minutes

    // Set up compliance monitoring
    setInterval(() => this.monitorCompliance(), 60 * 60 * 1000) // Every hour
  }

  private async performHealthChecks(): Promise<void> {
    try {
      // Check database connectivity
      await query('SELECT 1')

      // Check email providers
      // This would integrate with your email provider monitoring

      // Check API rate limits
      // This would check current usage against limits

    } catch (error) {
      await this.sendNotification('system_error', {
        error: `Health check failed: ${error.message}`,
        component: 'health_monitor'
      }, 'system', undefined, 'high')
    }
  }

  private async monitorPerformance(): Promise<void> {
    // Check for campaigns with high bounce rates
    const highBounceCampaigns = await query(`
      SELECT c.id, c.name,
             COALESCE(stats.bounced, 0) as bounced,
             COALESCE(stats.sent, 0) as sent
      FROM campaigns c
      LEFT JOIN campaign_stats stats ON c.id = stats.campaign_id
      WHERE c.status = 'active'
      AND stats.sent > 100
      AND (stats.bounced::float / stats.sent) > 0.05
    `)

    for (const campaign of highBounceCampaigns.rows) {
      const bounceRate = (campaign.bounced / campaign.sent) * 100
      await this.sendNotification('high_bounce_rate', {
        campaignId: campaign.id,
        campaignName: campaign.name,
        bounceRate: `${bounceRate.toFixed(1)}%`
      }, 'system', undefined, 'high')
    }

    // Check for high reply rates
    const highReplyCampaigns = await query(`
      SELECT c.id, c.name,
             COALESCE(stats.replied, 0) as replied,
             COALESCE(stats.delivered, 0) as delivered
      FROM campaigns c
      LEFT JOIN campaign_stats stats ON c.id = stats.campaign_id
      WHERE c.status = 'active'
      AND stats.delivered > 50
      AND (stats.replied::float / stats.delivered) > 0.10
    `)

    for (const campaign of highReplyCampaigns.rows) {
      const replyRate = (campaign.replied / campaign.delivered) * 100
      await this.sendNotification('high_reply_rate', {
        campaignId: campaign.id,
        campaignName: campaign.name,
        replyRate: `${replyRate.toFixed(1)}%`
      }, 'system', undefined, 'medium')
    }
  }

  private async monitorCompliance(): Promise<void> {
    // Check for compliance violations
    const { generateComplianceReport } = await import('@/lib/compliance')
    const report = await generateComplianceReport(
      new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
      new Date()
    )

    if (report.violations.length > 0) {
      await this.sendNotification('compliance_violation', {
        violations: report.violations,
        violationCount: report.violations.length
      }, 'system', undefined, 'critical')
    }
  }

  private async processEvent(event: NotificationEvent): Promise<void> {
    // Find matching rules
    const rules = await query(`
      SELECT * FROM notification_rules
      WHERE organization_id = $1 AND event_type = $2 AND enabled = true
    `, [event.organizationId, event.type])

    for (const ruleRow of rules.rows) {
      const rule: NotificationRule = {
        id: ruleRow.id,
        name: ruleRow.name,
        description: ruleRow.description,
        eventType: ruleRow.event_type,
        conditions: JSON.parse(ruleRow.conditions || '[]'),
        channels: JSON.parse(ruleRow.channels || '[]'),
        enabled: ruleRow.enabled,
        cooldownMinutes: ruleRow.cooldown_minutes,
        organizationId: ruleRow.organization_id,
        createdAt: ruleRow.created_at,
        updatedAt: ruleRow.updated_at
      }

      // Check cooldown
      if (await this.checkCooldown(rule, event)) {
        continue
      }

      // Check conditions
      if (this.evaluateConditions(rule.conditions, event.data)) {
        // Send to channels
        for (const channelId of rule.channels) {
          try {
            const channel = await this.getChannel(channelId)
            if (channel) {
              await this.sendToChannel(channel, event)

              // Record history
              await query(`
                INSERT INTO notification_history (
                  id, event_id, channel_id, status, sent_at
                ) VALUES ($1, $2, $3, $4, $5)
              `, [
                this.generateId('history'),
                event.id,
                channelId,
                'sent',
                new Date()
              ])
            }
          } catch (error) {
            console.error(`Failed to send notification to channel ${channelId}:`, error)

            // Record failed history
            await query(`
              INSERT INTO notification_history (
                id, event_id, channel_id, status, error
              ) VALUES ($1, $2, $3, $4, $5)
            `, [
              this.generateId('history'),
              event.id,
              channelId,
              'failed',
              error.message
            ])
          }
        }

        // Update event as sent
        await query(`
          UPDATE notification_events
          SET sent = true, sent_at = NOW()
          WHERE id = $1
        `, [event.id])
      }
    }
  }

  private async sendToChannel(channel: NotificationChannel, event: NotificationEvent): Promise<void> {
    const message = this.renderTemplate(event.type, event.data)

    switch (channel.type) {
      case 'email':
        await this.sendEmail(channel.config.email!, event.title, message)
        break

      case 'slack':
        await this.sendSlack(channel.config.slackWebhook!, event.title, message, event.severity)
        break

      case 'webhook':
        await this.sendWebhook(channel.config.webhookUrl!, event)
        break

      case 'sms':
        await this.sendSMS(channel.config.phoneNumber!, message)
        break
    }
  }

  private async sendEmail(to: string, subject: string, message: string): Promise<void> {
    // Implementation would use your email service
    console.log(`Sending email to ${to}: ${subject}`)
    // In production, integrate with SendGrid, SES, etc.
  }

  private async sendSlack(webhookUrl: string, title: string, message: string, severity: string): Promise<void> {
    const color = {
      low: 'good',
      medium: 'warning',
      high: 'danger',
      critical: 'danger'
    }[severity] || 'warning'

    const payload = {
      attachments: [{
        title,
        text: message,
        color,
        ts: Date.now() / 1000
      }]
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      throw new Error(`Slack webhook failed: ${response.status}`)
    }
  }

  private async sendWebhook(url: string, event: NotificationEvent): Promise<void> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event)
    })

    if (!response.ok) {
      throw new Error(`Webhook failed: ${response.status}`)
    }
  }

  private async sendSMS(phoneNumber: string, message: string): Promise<void> {
    // Implementation would use Twilio, AWS SNS, etc.
    console.log(`Sending SMS to ${phoneNumber}: ${message}`)
  }

  private renderTemplate(eventType: NotificationEventType, data: Record<string, any>): string {
    const template = this.templates.get(eventType)
    if (!template) return JSON.stringify(data)

    let message = template.message
    for (const variable of template.variables) {
      const value = data[variable] || `{{${variable}}}`
      message = message.replace(new RegExp(`{{${variable}}}`, 'g'), value)
    }

    return message
  }

  private getEventTitle(eventType: NotificationEventType): string {
    const titles: Record<NotificationEventType, string> = {
      campaign_started: 'Campaign Started',
      campaign_completed: 'Campaign Completed',
      campaign_paused: 'Campaign Paused',
      campaign_failed: 'Campaign Failed',
      high_bounce_rate: 'High Bounce Rate Alert',
      low_delivery_rate: 'Low Delivery Rate Alert',
      high_unsubscribe_rate: 'High Unsubscribe Rate Alert',
      sequence_stuck: 'Sequence Stuck Alert',
      campaign_goal_reached: 'Campaign Goal Reached',
      compliance_violation: 'Compliance Violation',
      domain_blacklisted: 'Domain Blacklisted',
      spam_complaint: 'Spam Complaint Received',
      system_error: 'System Error',
      api_rate_limit: 'API Rate Limit Reached',
      database_connection_issue: 'Database Connection Issue',
      email_provider_down: 'Email Provider Down',
      high_reply_rate: 'High Reply Rate',
      important_reply: 'Important Reply Received',
      sequence_stopped_on_reply: 'Sequence Stopped on Reply',
      contact_enrichment_failed: 'Contact Enrichment Failed',
      duplicate_contacts_found: 'Duplicate Contacts Found',
      contact_list_import_completed: 'Contact List Import Completed',
      ab_test_completed: 'A/B Test Completed',
      ab_test_winner_selected: 'A/B Test Winner Selected',
      custom_alert: 'Custom Alert'
    }

    return titles[eventType] || 'Notification'
  }

  private getEventMessage(eventType: NotificationEventType, data: Record<string, any>): string {
    // Return a basic message - templates will override this
    return `Event: ${eventType}. Data: ${JSON.stringify(data)}`
  }

  private evaluateConditions(conditions: NotificationCondition[], data: Record<string, any>): boolean {
    if (conditions.length === 0) return true

    let result = true
    let logic = 'and'

    for (const condition of conditions) {
      const fieldValue = this.getNestedValue(data, condition.field)
      const conditionResult = this.evaluateCondition(fieldValue, condition.operator, condition.value)

      if (logic === 'and') {
        result = result && conditionResult
      } else {
        result = result || conditionResult
      }

      logic = condition.logic
    }

    return result
  }

  private evaluateCondition(fieldValue: any, operator: string, expectedValue: any): boolean {
    switch (operator) {
      case 'equals':
        return fieldValue === expectedValue
      case 'not_equals':
        return fieldValue !== expectedValue
      case 'greater_than':
        return Number(fieldValue) > Number(expectedValue)
      case 'less_than':
        return Number(fieldValue) < Number(expectedValue)
      case 'contains':
        return String(fieldValue).includes(String(expectedValue))
      case 'in':
        return Array.isArray(expectedValue) && expectedValue.includes(fieldValue)
      default:
        return false
    }
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj)
  }

  private async checkCooldown(rule: NotificationRule, event: NotificationEvent): Promise<boolean> {
    if (rule.cooldownMinutes === 0) return false

    const cooldownStart = new Date(Date.now() - rule.cooldownMinutes * 60 * 1000)

    const result = await query(`
      SELECT COUNT(*) as count FROM notification_events
      WHERE organization_id = $1 AND type = $2 AND sent = true AND timestamp > $3
    `, [event.organizationId, event.type, cooldownStart])

    return parseInt(result.rows[0].count) > 0
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  private async getChannel(channelId: string): Promise<NotificationChannel | null> {
    const result = await query('SELECT * FROM notification_channels WHERE id = $1', [channelId])
    if (result.rows.length === 0) return null

    const row = result.rows[0]
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      config: JSON.parse(row.config || '{}'),
      enabled: row.enabled,
      organizationId: row.organization_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private async getRule(ruleId: string): Promise<NotificationRule | null> {
    const result = await query('SELECT * FROM notification_rules WHERE id = $1', [ruleId])
    if (result.rows.length === 0) return null

    const row = result.rows[0]
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      eventType: row.event_type,
      conditions: JSON.parse(row.conditions || '[]'),
      channels: JSON.parse(row.channels || '[]'),
      enabled: row.enabled,
      cooldownMinutes: row.cooldown_minutes,
      organizationId: row.organization_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}

// Singleton instance
export const notificationEngine = new NotificationEngine()

/**
 * Quick alert functions for common scenarios
 */
export async function alertCampaignStarted(campaignId: string, campaignName: string, totalContacts: number, organizationId: string): Promise<void> {
  await notificationEngine.sendNotification('campaign_started', {
    campaignId,
    campaignName,
    totalContacts,
    duration: 'ongoing'
  }, organizationId)
}

export async function alertHighBounceRate(campaignId: string, campaignName: string, bounceRate: number, organizationId: string): Promise<void> {
  await notificationEngine.sendNotification('high_bounce_rate', {
    campaignId,
    campaignName,
    bounceRate: `${bounceRate.toFixed(1)}%`
  }, organizationId, undefined, 'high')
}

export async function alertComplianceViolation(violation: string, organizationId: string): Promise<void> {
  await notificationEngine.sendNotification('compliance_violation', {
    violation
  }, organizationId, undefined, 'critical')
}

export async function alertSystemError(error: string, organizationId: string): Promise<void> {
  await notificationEngine.sendNotification('system_error', {
    error
  }, organizationId, undefined, 'high')
}
