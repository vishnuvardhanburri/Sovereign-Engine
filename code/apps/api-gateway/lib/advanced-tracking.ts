// @ts-nocheck
/**
 * Advanced Tracking System
 * Comprehensive email event tracking with conversation threading
 * Tracks opens, clicks, replies, bounces, unsubscribes with full analytics
 */

import { appEnv } from '@/lib/env'
import { query } from '@/lib/db'
import crypto from 'crypto'

export interface EmailEvent {
  id: string
  emailId: string
  contactEmail: string
  campaignId: string
  eventType: 'sent' | 'delivered' | 'open' | 'click' | 'reply' | 'bounce' | 'unsubscribe' | 'spam_report'
  timestamp: Date
  metadata: Record<string, any>
  ipAddress?: string
  userAgent?: string
  location?: {
    country: string
    region: string
    city: string
  }
}

export interface EmailLog {
  id: string
  emailId: string
  contactEmail: string
  campaignId: string
  sequenceId?: string
  sequenceStep?: number
  subject: string
  body: string
  sentAt: Date
  deliveredAt?: Date
  firstOpenedAt?: Date
  lastOpenedAt?: Date
  openCount: number
  clickCount: number
  replyCount: number
  bounced: boolean
  bounceReason?: string
  unsubscribed: boolean
  spamReported: boolean
  status: 'sent' | 'delivered' | 'bounced' | 'failed'
  trackingPixels: TrackingPixel[]
  links: TrackedLink[]
  conversationThread: ConversationMessage[]
}

export interface TrackingPixel {
  id: string
  url: string
  openedAt?: Date
  ipAddress?: string
  userAgent?: string
  location?: EmailEvent['location']
}

export interface TrackedLink {
  id: string
  originalUrl: string
  trackingUrl: string
  clickedAt?: Date
  clickCount: number
  ipAddresses: string[]
  userAgents: string[]
  locations: EmailEvent['location'][]
}

export interface ConversationMessage {
  id: string
  direction: 'outbound' | 'inbound'
  timestamp: Date
  subject: string
  body: string
  from: string
  to: string
  attachments?: string[]
  aiAnalysis?: {
    sentiment: 'positive' | 'neutral' | 'negative'
    intent: string
    urgency: 'low' | 'medium' | 'high'
  }
}

export interface TrackingAnalytics {
  totalEmails: number
  delivered: number
  opened: number
  clicked: number
  replied: number
  bounced: number
  unsubscribed: number
  spamReported: number
  deliveryRate: number
  openRate: number
  clickRate: number
  replyRate: number
  bounceRate: number
  unsubscribeRate: number
  averageOpenTime: number // minutes after send
  averageClickTime: number // minutes after send
  topLinks: Array<{ url: string; clicks: number }>
  geographicDistribution: Record<string, number>
  deviceBreakdown: Record<string, number>
}

class AdvancedTrackingEngine {
  private readonly trackingDomain: string
  private readonly pixelExpiryHours: number = 168 // 7 days

  constructor() {
    this.trackingDomain = appEnv.appBaseUrl().replace(/^https?:\/\//, '')
  }

  /**
   * Generate tracking pixel for email
   */
  generateTrackingPixel(emailId: string, contactEmail: string): TrackingPixel {
    const pixelId = this.generateTrackingId()
    const pixelUrl = `${appEnv.appBaseUrl()}/api/tracking/pixel/${pixelId}.png`

    const pixel: TrackingPixel = {
      id: pixelId,
      url: pixelUrl
    }

    // Store pixel mapping
    this.storePixelMapping(pixelId, emailId, contactEmail)

    return pixel
  }

  /**
   * Generate tracked link
   */
  generateTrackedLink(emailId: string, contactEmail: string, originalUrl: string): TrackedLink {
    const linkId = this.generateTrackingId()
    const trackingUrl = `${appEnv.appBaseUrl()}/api/tracking/link/${linkId}`

    const link: TrackedLink = {
      id: linkId,
      originalUrl,
      trackingUrl,
      clickCount: 0,
      ipAddresses: [],
      userAgents: [],
      locations: []
    }

    // Store link mapping
    this.storeLinkMapping(linkId, emailId, contactEmail, originalUrl)

    return link
  }

  /**
   * Process tracking pixel request
   */
  async processPixelRequest(
    pixelId: string,
    ipAddress: string,
    userAgent: string
  ): Promise<void> {
    try {
      // Get pixel mapping
      const mapping = await this.getPixelMapping(pixelId)
      if (!mapping) return

      // Get location data
      const location = await this.getLocationFromIP(ipAddress)

      // Record open event
      await this.recordEvent({
        emailId: mapping.emailId,
        contactEmail: mapping.contactEmail,
        campaignId: mapping.campaignId,
        eventType: 'open',
        timestamp: new Date(),
        metadata: { pixelId },
        ipAddress,
        userAgent,
        location
      })

      // Update email log
      await this.updateEmailLog(mapping.emailId, {
        firstOpenedAt: mapping.firstOpenedAt || new Date(),
        lastOpenedAt: new Date(),
        openCount: mapping.openCount + 1
      })

    } catch (error) {
      console.error('Pixel tracking error:', error)
    }
  }

  /**
   * Process tracked link click
   */
  async processLinkClick(
    linkId: string,
    ipAddress: string,
    userAgent: string
  ): Promise<string | null> {
    try {
      // Get link mapping
      const mapping = await this.getLinkMapping(linkId)
      if (!mapping) return null

      // Get location data
      const location = await this.getLocationFromIP(ipAddress)

      // Record click event
      await this.recordEvent({
        emailId: mapping.emailId,
        contactEmail: mapping.contactEmail,
        campaignId: mapping.campaignId,
        eventType: 'click',
        timestamp: new Date(),
        metadata: { linkId, originalUrl: mapping.originalUrl },
        ipAddress,
        userAgent,
        location
      })

      // Update link tracking
      await this.updateLinkTracking(linkId, ipAddress, userAgent, location)

      // Update email log
      await this.updateEmailLog(mapping.emailId, {
        clickCount: mapping.clickCount + 1
      })

      return mapping.originalUrl

    } catch (error) {
      console.error('Link tracking error:', error)
      return null
    }
  }

  /**
   * Record email event
   */
  async recordEvent(event: Omit<EmailEvent, 'id'>): Promise<void> {
    // Generate event ID
    const eventId = this.generateEventId()

    await query(`
      INSERT INTO email_events (
        id, email_id, contact_email, campaign_id, event_type,
        timestamp, metadata, ip_address, user_agent, location_country,
        location_region, location_city
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [
      eventId,
      event.emailId,
      event.contactEmail,
      event.campaignId,
      event.eventType,
      event.timestamp,
      JSON.stringify(event.metadata),
      event.ipAddress || null,
      event.userAgent || null,
      event.location?.country || null,
      event.location?.region || null,
      event.location?.city || null
    ])

    // Update email log based on event type
    await this.updateEmailLogFromEvent(event)
  }

  /**
   * Record reply event
   */
  async recordReply(
    emailId: string,
    contactEmail: string,
    campaignId: string,
    replySubject: string,
    replyBody: string,
    replyTimestamp: Date
  ): Promise<void> {
    // Record reply event
    await this.recordEvent({
      emailId,
      contactEmail,
      campaignId,
      eventType: 'reply',
      timestamp: replyTimestamp,
      metadata: { subject: replySubject, body: replyBody }
    })

    // Add to conversation thread
    await this.addToConversationThread({
      emailId,
      direction: 'inbound',
      timestamp: replyTimestamp,
      subject: replySubject,
      body: replyBody,
      from: contactEmail,
      to: 'system', // Would be actual recipient
      aiAnalysis: await this.analyzeReplySentiment(replyBody)
    })

    // Update email log
    const currentLog = await this.getEmailLog(emailId)
    if (currentLog) {
      await this.updateEmailLog(emailId, {
        replyCount: currentLog.replyCount + 1
      })
    }
  }

  /**
   * Record bounce event
   */
  async recordBounce(
    emailId: string,
    contactEmail: string,
    campaignId: string,
    bounceType: 'hard' | 'soft',
    bounceReason: string
  ): Promise<void> {
    await this.recordEvent({
      emailId,
      contactEmail,
      campaignId,
      eventType: 'bounce',
      timestamp: new Date(),
      metadata: { bounceType, bounceReason }
    })

    // Update email log
    await this.updateEmailLog(emailId, {
      bounced: true,
      bounceReason,
      status: bounceType === 'hard' ? 'bounced' : 'sent'
    })
  }

  /**
   * Record unsubscribe event
   */
  async recordUnsubscribe(
    emailId: string,
    contactEmail: string,
    campaignId: string,
    source: string
  ): Promise<void> {
    await this.recordEvent({
      emailId,
      contactEmail,
      campaignId,
      eventType: 'unsubscribe',
      timestamp: new Date(),
      metadata: { source }
    })

    // Update email log
    await this.updateEmailLog(emailId, {
      unsubscribed: true
    })
  }

  /**
   * Create email log entry
   */
  async createEmailLog(log: Omit<EmailLog, 'id' | 'trackingPixels' | 'links' | 'conversationThread'>): Promise<string> {
    const logId = this.generateLogId()

    await query(`
      INSERT INTO email_logs (
        id, email_id, contact_email, campaign_id, sequence_id, sequence_step,
        subject, body, sent_at, status, open_count, click_count, reply_count,
        bounced, unsubscribed, spam_reported
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    `, [
      logId,
      log.emailId,
      log.contactEmail,
      log.campaignId,
      log.sequenceId || null,
      log.sequenceStep || null,
      log.subject,
      log.body,
      log.sentAt,
      log.status,
      log.openCount,
      log.clickCount,
      log.replyCount,
      log.bounced,
      log.unsubscribed,
      log.spamReported
    ])

    return logId
  }

  /**
   * Get email log
   */
  async getEmailLog(emailId: string): Promise<EmailLog | null> {
    const result = await query(`
      SELECT * FROM email_logs WHERE email_id = $1
    `, [emailId])

    if (result.rows.length === 0) return null

    const row = result.rows[0]

    return {
      id: row.id,
      emailId: row.email_id,
      contactEmail: row.contact_email,
      campaignId: row.campaign_id,
      sequenceId: row.sequence_id,
      sequenceStep: row.sequence_step,
      subject: row.subject,
      body: row.body,
      sentAt: row.sent_at,
      deliveredAt: row.delivered_at,
      firstOpenedAt: row.first_opened_at,
      lastOpenedAt: row.last_opened_at,
      openCount: row.open_count,
      clickCount: row.click_count,
      replyCount: row.reply_count,
      bounced: row.bounced,
      bounceReason: row.bounce_reason,
      unsubscribed: row.unsubscribed,
      spamReported: row.spam_reported,
      status: row.status,
      trackingPixels: await this.getTrackingPixels(emailId),
      links: await this.getTrackedLinks(emailId),
      conversationThread: await this.getConversationThread(emailId)
    }
  }

  /**
   * Get tracking analytics
   */
  async getTrackingAnalytics(
    campaignId?: string,
    timeframe: 'day' | 'week' | 'month' = 'month'
  ): Promise<TrackingAnalytics> {
    const interval = timeframe === 'day' ? '1 day' :
                    timeframe === 'week' ? '7 days' : '30 days'

    let campaignFilter = ''
    let params: any[] = []

    if (campaignId) {
      campaignFilter = 'AND el.campaign_id = $1'
      params.push(campaignId)
    }

    const results = await query(`
      SELECT
        COUNT(DISTINCT el.id) as total_emails,
        COUNT(CASE WHEN el.status = 'delivered' THEN 1 END) as delivered,
        COUNT(CASE WHEN el.open_count > 0 THEN 1 END) as opened,
        COUNT(CASE WHEN el.click_count > 0 THEN 1 END) as clicked,
        COUNT(CASE WHEN el.reply_count > 0 THEN 1 END) as replied,
        COUNT(CASE WHEN el.bounced THEN 1 END) as bounced,
        COUNT(CASE WHEN el.unsubscribed THEN 1 END) as unsubscribed,
        COUNT(CASE WHEN el.spam_reported THEN 1 END) as spam_reported,
        AVG(EXTRACT(EPOCH FROM (el.first_opened_at - el.sent_at))/60) as avg_open_time,
        AVG(EXTRACT(EPOCH FROM (MIN(ee.timestamp) - el.sent_at))/60) as avg_click_time
      FROM email_logs el
      LEFT JOIN email_events ee ON el.email_id = ee.email_id AND ee.event_type = 'click'
      WHERE el.sent_at >= NOW() - INTERVAL '${interval}'
      ${campaignFilter}
      GROUP BY el.sent_at
    `, params)

    // Get top links
    const linkResults = await query(`
      SELECT tl.original_url, COUNT(*) as clicks
      FROM tracked_links tl
      JOIN link_clicks lc ON tl.id = lc.link_id
      WHERE lc.clicked_at >= NOW() - INTERVAL '${interval}'
      ${campaignId ? 'AND tl.campaign_id = $' + (params.length + 1) : ''}
      GROUP BY tl.original_url
      ORDER BY clicks DESC
      LIMIT 10
    `, campaignId ? [...params, campaignId] : params)

    // Get geographic distribution
    const geoResults = await query(`
      SELECT location_country, COUNT(*) as count
      FROM email_events
      WHERE event_type IN ('open', 'click')
      AND timestamp >= NOW() - INTERVAL '${interval}'
      ${campaignId ? 'AND campaign_id = $' + (params.length + 1) : ''}
      AND location_country IS NOT NULL
      GROUP BY location_country
      ORDER BY count DESC
    `, campaignId ? [...params, campaignId] : params)

    // Get device breakdown
    const deviceResults = await query(`
      SELECT
        CASE
          WHEN user_agent ILIKE '%mobile%' THEN 'mobile'
          WHEN user_agent ILIKE '%tablet%' THEN 'tablet'
          WHEN user_agent ILIKE '%desktop%' THEN 'desktop'
          ELSE 'unknown'
        END as device,
        COUNT(*) as count
      FROM email_events
      WHERE event_type IN ('open', 'click')
      AND timestamp >= NOW() - INTERVAL '${interval}'
      ${campaignId ? 'AND campaign_id = $' + (params.length + 1) : ''}
      GROUP BY device
    `, campaignId ? [...params, campaignId] : params)

    const stats = results.rows[0] || {}
    const total = parseInt(stats.total_emails) || 0

    const topLinks = linkResults.rows.map(row => ({
      url: row.original_url,
      clicks: parseInt(row.clicks)
    }))

    const geographicDistribution: Record<string, number> = {}
    for (const row of geoResults.rows) {
      geographicDistribution[row.location_country] = parseInt(row.count)
    }

    const deviceBreakdown: Record<string, number> = {}
    for (const row of deviceResults.rows) {
      deviceBreakdown[row.device] = parseInt(row.count)
    }

    return {
      totalEmails: total,
      delivered: parseInt(stats.delivered) || 0,
      opened: parseInt(stats.opened) || 0,
      clicked: parseInt(stats.clicked) || 0,
      replied: parseInt(stats.replied) || 0,
      bounced: parseInt(stats.bounced) || 0,
      unsubscribed: parseInt(stats.unsubscribed) || 0,
      spamReported: parseInt(stats.spam_reported) || 0,
      deliveryRate: total > 0 ? (parseInt(stats.delivered) || 0) / total : 0,
      openRate: total > 0 ? (parseInt(stats.opened) || 0) / total : 0,
      clickRate: total > 0 ? (parseInt(stats.clicked) || 0) / total : 0,
      replyRate: total > 0 ? (parseInt(stats.replied) || 0) / total : 0,
      bounceRate: total > 0 ? (parseInt(stats.bounced) || 0) / total : 0,
      unsubscribeRate: total > 0 ? (parseInt(stats.unsubscribed) || 0) / total : 0,
      averageOpenTime: parseFloat(stats.avg_open_time) || 0,
      averageClickTime: parseFloat(stats.avg_click_time) || 0,
      topLinks,
      geographicDistribution,
      deviceBreakdown
    }
  }

  /**
   * Get conversation thread for email
   */
  async getConversationThread(emailId: string): Promise<ConversationMessage[]> {
    const result = await query(`
      SELECT * FROM conversation_messages
      WHERE email_id = $1
      ORDER BY timestamp ASC
    `, [emailId])

    return result.rows.map(row => ({
      id: row.id,
      direction: row.direction,
      timestamp: row.timestamp,
      subject: row.subject,
      body: row.body,
      from: row.from_address,
      to: row.to_address,
      attachments: row.attachments ? JSON.parse(row.attachments) : undefined,
      aiAnalysis: row.ai_analysis ? JSON.parse(row.ai_analysis) : undefined
    }))
  }

  // Private helper methods

  private generateTrackingId(): string {
    return crypto.randomBytes(16).toString('hex')
  }

  private generateEventId(): string {
    return `evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
  }

  private generateLogId(): string {
    return `log_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
  }

  private async storePixelMapping(pixelId: string, emailId: string, contactEmail: string): Promise<void> {
    // Get campaign ID from email
    const emailResult = await query('SELECT campaign_id FROM queued_emails WHERE id = $1', [emailId])
    const campaignId = emailResult.rows[0]?.campaign_id

    await query(`
      INSERT INTO tracking_pixels (pixel_id, email_id, contact_email, campaign_id, created_at)
      VALUES ($1, $2, $3, $4, NOW())
    `, [pixelId, emailId, contactEmail, campaignId])
  }

  private async storeLinkMapping(linkId: string, emailId: string, contactEmail: string, originalUrl: string): Promise<void> {
    const emailResult = await query('SELECT campaign_id FROM queued_emails WHERE id = $1', [emailId])
    const campaignId = emailResult.rows[0]?.campaign_id

    await query(`
      INSERT INTO tracked_links (id, email_id, contact_email, campaign_id, original_url, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
    `, [linkId, emailId, contactEmail, campaignId, originalUrl])
  }

  private async getPixelMapping(pixelId: string): Promise<any> {
    const result = await query(`
      SELECT tp.*, el.open_count, el.first_opened_at
      FROM tracking_pixels tp
      LEFT JOIN email_logs el ON tp.email_id = el.email_id
      WHERE tp.pixel_id = $1
    `, [pixelId])

    return result.rows[0] || null
  }

  private async getLinkMapping(linkId: string): Promise<any> {
    const result = await query(`
      SELECT tl.*, el.click_count
      FROM tracked_links tl
      LEFT JOIN email_logs el ON tl.email_id = el.email_id
      WHERE tl.id = $1
    `, [linkId])

    return result.rows[0] || null
  }

  private async getLocationFromIP(ipAddress: string): Promise<EmailEvent['location'] | undefined> {
    try {
      const response = await fetch(`http://ipapi.co/${ipAddress}/json/`)
      if (!response.ok) return undefined

      const data = await response.json()
      return {
        country: data.country_name || 'Unknown',
        region: data.region || 'Unknown',
        city: data.city || 'Unknown'
      }
    } catch (error) {
      return undefined
    }
  }

  private async updateEmailLogFromEvent(event: Omit<EmailEvent, 'id'>): Promise<void> {
    const updates: Record<string, any> = {}

    switch (event.eventType) {
      case 'delivered':
        updates.deliveredAt = event.timestamp
        updates.status = 'delivered'
        break
      case 'bounce':
        updates.bounced = true
        updates.bounceReason = event.metadata?.bounceReason
        updates.status = 'bounced'
        break
      case 'unsubscribe':
        updates.unsubscribed = true
        break
      case 'spam_report':
        updates.spamReported = true
        break
    }

    if (Object.keys(updates).length > 0) {
      await this.updateEmailLog(event.emailId, updates)
    }
  }

  private async updateEmailLog(emailId: string, updates: Record<string, any>): Promise<void> {
    const setParts: string[] = []
    const values: any[] = []
    let paramIndex = 1

    for (const [key, value] of Object.entries(updates)) {
      const columnName = this.camelToSnake(key)
      setParts.push(`${columnName} = $${paramIndex}`)
      values.push(value)
      paramIndex++
    }

    if (setParts.length === 0) return

    values.push(emailId)

    await query(`
      UPDATE email_logs
      SET ${setParts.join(', ')}
      WHERE email_id = $${paramIndex}
    `, values)
  }

  private async updateLinkTracking(
    linkId: string,
    ipAddress: string,
    userAgent: string,
    location?: EmailEvent['location']
  ): Promise<void> {
    await query(`
      INSERT INTO link_clicks (link_id, clicked_at, ip_address, user_agent, location)
      VALUES ($1, NOW(), $2, $3, $4)
    `, [linkId, ipAddress, userAgent, location ? JSON.stringify(location) : null])

    // Update click count
    await query(`
      UPDATE tracked_links
      SET click_count = click_count + 1
      WHERE id = $1
    `, [linkId])
  }

  private async addToConversationThread(message: {
    emailId: string
    direction: 'outbound' | 'inbound'
    timestamp: Date
    subject: string
    body: string
    from: string
    to: string
    aiAnalysis?: any
  }): Promise<void> {
    await query(`
      INSERT INTO conversation_messages (
        email_id, direction, timestamp, subject, body,
        from_address, to_address, ai_analysis
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      message.emailId,
      message.direction,
      message.timestamp,
      message.subject,
      message.body,
      message.from,
      message.to,
      message.aiAnalysis ? JSON.stringify(message.aiAnalysis) : null
    ])
  }

  private async analyzeReplySentiment(body: string): Promise<ConversationMessage['aiAnalysis']> {
    // Simple sentiment analysis - could be enhanced with AI
    const positiveWords = ['great', 'good', 'excellent', 'amazing', 'perfect', 'love', 'awesome']
    const negativeWords = ['bad', 'terrible', 'awful', 'horrible', 'hate', 'worst']

    const positiveCount = positiveWords.filter(word => body.toLowerCase().includes(word)).length
    const negativeCount = negativeWords.filter(word => body.toLowerCase().includes(word)).length

    let sentiment: 'positive' | 'neutral' | 'negative' = 'neutral'
    if (positiveCount > negativeCount) sentiment = 'positive'
    if (negativeCount > positiveCount) sentiment = 'negative'

    const urgencyIndicators = ['urgent', 'asap', 'immediately', 'right away', 'emergency']
    const urgency = urgencyIndicators.some(word => body.toLowerCase().includes(word)) ? 'high' : 'low'

    return {
      sentiment,
      intent: 'reply',
      urgency: urgency as any
    }
  }

  private camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
  }

  private async getTrackingPixels(emailId: string): Promise<TrackingPixel[]> {
    const result = await query(`
      SELECT * FROM tracking_pixels WHERE email_id = $1
    `, [emailId])

    return result.rows.map(row => ({
      id: row.pixel_id,
      url: `${appEnv.appBaseUrl()}/api/tracking/pixel/${row.pixel_id}.png`,
      openedAt: row.opened_at,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      location: row.location ? JSON.parse(row.location) : undefined
    }))
  }

  private async getTrackedLinks(emailId: string): Promise<TrackedLink[]> {
    const result = await query(`
      SELECT tl.*, COUNT(lc.id) as click_count
      FROM tracked_links tl
      LEFT JOIN link_clicks lc ON tl.id = lc.link_id
      WHERE tl.email_id = $1
      GROUP BY tl.id
    `, [emailId])

    return result.rows.map(row => ({
      id: row.id,
      originalUrl: row.original_url,
      trackingUrl: `${appEnv.appBaseUrl()}/api/tracking/link/${row.id}`,
      clickCount: parseInt(row.click_count) || 0,
      ipAddresses: [], // Would need to aggregate from link_clicks
      userAgents: [],
      locations: []
    }))
  }
}

// Singleton instance
export const advancedTracking = new AdvancedTrackingEngine()

/**
 * Record email send event
 */
export async function recordEmailSent(
  emailId: string,
  contactEmail: string,
  campaignId: string,
  subject: string,
  body: string,
  options?: {
    sequenceId?: string
    sequenceStep?: number
  }
): Promise<void> {
  // Create email log
  await advancedTracking.createEmailLog({
    emailId,
    contactEmail,
    campaignId,
    sequenceId: options?.sequenceId,
    sequenceStep: options?.sequenceStep,
    subject,
    body,
    sentAt: new Date(),
    openCount: 0,
    clickCount: 0,
    replyCount: 0,
    bounced: false,
    unsubscribed: false,
    spamReported: false,
    status: 'sent'
  })

  // Record sent event
  await advancedTracking.recordEvent({
    emailId,
    contactEmail,
    campaignId,
    eventType: 'sent',
    timestamp: new Date(),
    metadata: {}
  })
}

/**
 * Generate tracking-enhanced email content
 */
export function generateTrackedEmailContent(
  emailId: string,
  contactEmail: string,
  subject: string,
  body: string
): {
  trackedSubject: string
  trackedBody: string
  trackingPixel: TrackingPixel
  trackedLinks: TrackedLink[]
} {
  // Generate tracking pixel
  const trackingPixel = advancedTracking.generateTrackingPixel(emailId, contactEmail)

  // Find and replace links with tracked versions
  const linkRegex = /https?:\/\/[^\s<>"']+/g
  const trackedLinks: TrackedLink[] = []
  let trackedBody = body

  const links = body.match(linkRegex) || []
  for (const link of links) {
    const trackedLink = advancedTracking.generateTrackedLink(emailId, contactEmail, link)
    trackedLinks.push(trackedLink)
    trackedBody = trackedBody.replace(link, trackedLink.trackingUrl)
  }

  // Add tracking pixel to body
  trackedBody += `\n\n<img src="${trackingPixel.url}" width="1" height="1" style="display:none;" alt="" />`

  return {
    trackedSubject: subject,
    trackedBody,
    trackingPixel,
    trackedLinks
  }
}
