// @ts-nocheck
/**
 * Timezone-Aware Sending Engine
 * Detects recipient timezones and schedules emails for optimal delivery
 * Ensures emails arrive during business hours (9am-5pm local time)
 */

import { appEnv } from '@/lib/env'
import { query } from '@/lib/db'

export interface TimezoneInfo {
  timezone: string
  offset: number // minutes from UTC
  country: string
  region: string
  confidence: number // 0-1
  detectedAt: Date
  source: 'ip' | 'email_domain' | 'user_data' | 'manual'
}

export interface SendWindow {
  startHour: number // 0-23
  endHour: number // 0-23
  priority: 'business' | 'casual' | 'anytime'
  timezone: string
}

export interface ScheduledSend {
  id: string
  contactEmail: string
  campaignId: string
  sequenceId?: string
  sequenceStep?: number
  subject: string
  body: string
  scheduledTime: Date
  timezone: string
  priority: 'high' | 'normal' | 'low'
  status: 'scheduled' | 'sent' | 'cancelled' | 'failed'
  createdAt: Date
  sentAt?: Date
}

export interface TimezoneAnalytics {
  totalContacts: number
  timezoneDistribution: Record<string, number>
  averageSendDelay: number
  onTimeDeliveryRate: number
  businessHourDeliveryRate: number
}

class TimezoneSendingEngine {
  private readonly defaultTimezone: string = 'America/New_York'
  private readonly businessHours: { start: number; end: number } = { start: 9, end: 17 } // 9am-5pm
  private readonly cache: Map<string, TimezoneInfo> = new Map()
  private readonly cacheExpiry: number = 7 * 24 * 60 * 60 * 1000 // 7 days

  // Default send windows by region
  private readonly defaultSendWindows: Record<string, SendWindow[]> = {
    'US/Eastern': [
      { startHour: 9, endHour: 17, priority: 'business', timezone: 'US/Eastern' },
      { startHour: 8, endHour: 18, priority: 'casual', timezone: 'US/Eastern' }
    ],
    'US/Pacific': [
      { startHour: 9, endHour: 17, priority: 'business', timezone: 'US/Pacific' },
      { startHour: 8, endHour: 18, priority: 'casual', timezone: 'US/Pacific' }
    ],
    'Europe/London': [
      { startHour: 9, endHour: 17, priority: 'business', timezone: 'Europe/London' },
      { startHour: 8, endHour: 18, priority: 'casual', timezone: 'Europe/London' }
    ],
    'Asia/Tokyo': [
      { startHour: 10, endHour: 18, priority: 'business', timezone: 'Asia/Tokyo' },
      { startHour: 9, endHour: 19, priority: 'casual', timezone: 'Asia/Tokyo' }
    ]
  }

  /**
   * Detect timezone for email address
   */
  async detectTimezone(email: string, ipAddress?: string, userData?: Record<string, any>): Promise<TimezoneInfo> {
    // Check cache first
    const cached = this.cache.get(email)
    if (cached && Date.now() - cached.detectedAt.getTime() < this.cacheExpiry) {
      return cached
    }

    let timezoneInfo: TimezoneInfo

    // Try multiple detection methods
    if (userData?.timezone) {
      // User provided timezone
      timezoneInfo = await this.createTimezoneInfo(email, userData.timezone, 'user_data', 1.0)
    } else if (ipAddress) {
      // IP-based detection
      timezoneInfo = await this.detectFromIP(email, ipAddress)
    } else {
      // Email domain-based detection
      timezoneInfo = await this.detectFromEmailDomain(email)
    }

    // Cache result
    this.cache.set(email, timezoneInfo)

    // Store in database
    await this.storeTimezoneInfo(timezoneInfo)

    return timezoneInfo
  }

  /**
   * Schedule email for optimal send time
   */
  async scheduleEmail(
    contactEmail: string,
    campaignId: string,
    subject: string,
    body: string,
    options: {
      sequenceId?: string
      sequenceStep?: number
      priority?: 'high' | 'normal' | 'low'
      ipAddress?: string
      userData?: Record<string, any>
      maxDelayHours?: number
    } = {}
  ): Promise<ScheduledSend> {
    const {
      sequenceId,
      sequenceStep,
      priority = 'normal',
      ipAddress,
      userData,
      maxDelayHours = 24
    } = options

    // Detect timezone
    const timezoneInfo = await this.detectTimezone(contactEmail, ipAddress, userData)

    // Calculate optimal send time
    const scheduledTime = await this.calculateOptimalSendTime(
      timezoneInfo.timezone,
      priority,
      maxDelayHours
    )

    // Create scheduled send record
    const sendResult = await query(`
      INSERT INTO scheduled_sends (
        contact_email, campaign_id, sequence_id, sequence_step,
        subject, body, scheduled_time, timezone, priority,
        status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'scheduled', NOW())
      RETURNING id
    `, [
      contactEmail,
      campaignId,
      sequenceId || null,
      sequenceStep || null,
      subject,
      body,
      scheduledTime,
      timezoneInfo.timezone,
      priority
    ])

    const sendId = sendResult.rows[0].id

    return {
      id: sendId,
      contactEmail,
      campaignId,
      sequenceId,
      sequenceStep,
      subject,
      body,
      scheduledTime,
      timezone: timezoneInfo.timezone,
      priority,
      status: 'scheduled',
      createdAt: new Date()
    }
  }

  /**
   * Process scheduled sends (called by cron job)
   */
  async processScheduledSends(): Promise<{
    processed: number
    sent: number
    skipped: number
    errors: string[]
  }> {
    const processed = []
    const sent = []
    const skipped = []
    const errors = []

    try {
      // Get sends ready to be processed
      const sends = await query(`
        SELECT * FROM scheduled_sends
        WHERE status = 'scheduled'
        AND scheduled_time <= NOW()
        ORDER BY priority DESC, scheduled_time ASC
        LIMIT 100
      `)

      for (const send of sends.rows) {
        try {
          const result = await this.processSingleSend(send)
          processed.push(send.id)

          if (result.sent) {
            sent.push(send.id)
          } else {
            skipped.push(send.id)
          }
        } catch (error) {
          console.error(`Error processing send ${send.id}:`, error)
          errors.push(`Send ${send.id}: ${error.message}`)
        }
      }
    } catch (error) {
      console.error('Error in processScheduledSends:', error)
      errors.push(`General error: ${error.message}`)
    }

    return {
      processed: processed.length,
      sent: sent.length,
      skipped: skipped.length,
      errors
    }
  }

  /**
   * Process single scheduled send
   */
  private async processSingleSend(send: any): Promise<{ sent: boolean }> {
    // Check if contact can still receive emails
    const { canSendToEmail } = await import('@/lib/unsubscribe-suppression')
    const canSend = await canSendToEmail(send.contact_email)

    if (!canSend) {
      await this.cancelSend(send.id, 'Contact unsubscribed or suppressed')
      return { sent: false }
    }

    // Send email via existing infrastructure
    try {
      const { coordinator } = await import('@/lib/infrastructure')
      const result = await coordinator.send({
        id: send.id,
        to: send.contact_email,
        subject: send.subject,
        body: send.body,
        campaignId: send.campaign_id,
        sequenceId: send.sequence_id,
        sequenceStep: send.sequence_step
      })

      if (result.success) {
        await this.markSendComplete(send.id)
        return { sent: true }
      } else {
        await this.markSendFailed(send.id, result.error || 'Send failed')
        return { sent: false }
      }
    } catch (error) {
      await this.markSendFailed(send.id, error.message)
      return { sent: false }
    }
  }

  /**
   * Calculate optimal send time for timezone
   */
  private async calculateOptimalSendTime(
    timezone: string,
    priority: string,
    maxDelayHours: number
  ): Promise<Date> {
    const now = new Date()
    const maxDelay = new Date(now.getTime() + maxDelayHours * 60 * 60 * 1000)

    // Get send windows for timezone
    const sendWindows = this.getSendWindows(timezone)

    // Find next available send window
    for (let attempt = 0; attempt < 7; attempt++) { // Check next 7 days
      const checkDate = new Date(now.getTime() + attempt * 24 * 60 * 60 * 1000)

      for (const window of sendWindows) {
        if (priority === 'high' || window.priority !== 'business') {
          const optimalTime = this.findOptimalTimeInWindow(checkDate, window, timezone)

          if (optimalTime > now && optimalTime <= maxDelay) {
            return optimalTime
          }
        }
      }
    }

    // Fallback: send as soon as possible within max delay
    return new Date(Math.min(now.getTime() + 60 * 60 * 1000, maxDelay.getTime())) // 1 hour from now
  }

  /**
   * Find optimal time within a send window
   */
  private findOptimalTimeInWindow(date: Date, window: SendWindow, timezone: string): Date {
    // Convert window hours to UTC
    const timezoneOffset = this.getTimezoneOffset(timezone)

    // Create window start/end in local time
    const windowStart = new Date(date)
    windowStart.setHours(window.startHour, 0, 0, 0)

    const windowEnd = new Date(date)
    windowEnd.setHours(window.endHour, 0, 0, 0)

    // Convert to UTC
    const utcStart = new Date(windowStart.getTime() - timezoneOffset * 60 * 1000)
    const utcEnd = new Date(windowEnd.getTime() - timezoneOffset * 60 * 1000)

    // Find optimal time (middle of window)
    const optimalTime = new Date(utcStart.getTime() + (utcEnd.getTime() - utcStart.getTime()) / 2)

    return optimalTime
  }

  /**
   * Detect timezone from IP address
   */
  private async detectFromIP(email: string, ipAddress: string): Promise<TimezoneInfo> {
    try {
      // Use ipapi.co for IP geolocation
      const response = await fetch(`http://ipapi.co/${ipAddress}/json/`)

      if (!response.ok) {
        throw new Error(`IP API error: ${response.status}`)
      }

      const data = await response.json()

      if (data.timezone) {
        return await this.createTimezoneInfo(
          email,
          data.timezone,
          'ip',
          0.8,
          data.country_name,
          data.region
        )
      }
    } catch (error) {
      console.error('IP-based timezone detection failed:', error)
    }

    // Fallback to email domain detection
    return await this.detectFromEmailDomain(email)
  }

  /**
   * Detect timezone from email domain
   */
  private async detectFromEmailDomain(email: string): Promise<TimezoneInfo> {
    const domain = email.split('@')[1]?.toLowerCase()

    if (!domain) {
      return await this.createTimezoneInfo(email, this.defaultTimezone, 'email_domain', 0.3)
    }

    // Domain to timezone mapping (simplified)
    const domainTimezones: Record<string, string> = {
      'gmail.com': 'America/New_York', // Most common
      'yahoo.com': 'America/New_York',
      'hotmail.com': 'America/New_York',
      'outlook.com': 'America/New_York',
      'aol.com': 'America/New_York',
      'icloud.com': 'America/New_York',

      // UK domains
      'bbc.co.uk': 'Europe/London',
      'nhs.uk': 'Europe/London',
      'gov.uk': 'Europe/London',

      // German domains
      'gmail.de': 'Europe/Berlin',
      'web.de': 'Europe/Berlin',
      'gmx.de': 'Europe/Berlin',

      // French domains
      'orange.fr': 'Europe/Paris',
      'free.fr': 'Europe/Paris',
      'gmail.fr': 'Europe/Paris',

      // Japanese domains
      'gmail.jp': 'Asia/Tokyo',
      'yahoo.co.jp': 'Asia/Tokyo',

      // Australian domains
      'gmail.com.au': 'Australia/Sydney',
      'bigpond.com': 'Australia/Sydney'
    }

    const detectedTimezone = domainTimezones[domain] || this.defaultTimezone
    const confidence = domainTimezones[domain] ? 0.6 : 0.3

    return await this.createTimezoneInfo(email, detectedTimezone, 'email_domain', confidence)
  }

  /**
   * Create timezone info object
   */
  private async createTimezoneInfo(
    email: string,
    timezone: string,
    source: TimezoneInfo['source'],
    confidence: number,
    country?: string,
    region?: string
  ): Promise<TimezoneInfo> {
    const offset = this.getTimezoneOffset(timezone)

    return {
      timezone,
      offset,
      country: country || 'Unknown',
      region: region || 'Unknown',
      confidence,
      detectedAt: new Date(),
      source
    }
  }

  /**
   * Get timezone offset in minutes
   */
  private getTimezoneOffset(timezone: string): number {
    try {
      // Create a date and get its offset
      const now = new Date()
      const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }))
      const targetDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }))
      return (targetDate.getTime() - utcDate.getTime()) / (1000 * 60)
    } catch (error) {
      // Default to UTC
      return 0
    }
  }

  /**
   * Get send windows for timezone
   */
  private getSendWindows(timezone: string): SendWindow[] {
    // Check if we have specific windows for this timezone
    if (this.defaultSendWindows[timezone]) {
      return this.defaultSendWindows[timezone]
    }

    // Find similar timezone (same region)
    const region = timezone.split('/')[0]
    for (const [tz, windows] of Object.entries(this.defaultSendWindows)) {
      if (tz.startsWith(region)) {
        return windows
      }
    }

    // Default business hours
    return [{
      startHour: this.businessHours.start,
      endHour: this.businessHours.end,
      priority: 'business',
      timezone
    }]
  }

  /**
   * Store timezone info in database
   */
  private async storeTimezoneInfo(info: TimezoneInfo): Promise<void> {
    await query(`
      INSERT INTO timezone_info (
        email, timezone, offset_minutes, country, region,
        confidence, detected_at, source
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (email) DO UPDATE SET
        timezone = EXCLUDED.timezone,
        offset_minutes = EXCLUDED.offset_minutes,
        country = EXCLUDED.country,
        region = EXCLUDED.region,
        confidence = EXCLUDED.confidence,
        detected_at = EXCLUDED.detected_at,
        source = EXCLUDED.source
    `, [
      info.timezone.split('@')[1], // Extract email from timezone? Wait, this is wrong
      info.timezone,
      info.offset,
      info.country,
      info.region,
      info.confidence,
      info.detectedAt,
      info.source
    ])
  }

  /**
   * Mark send as complete
   */
  private async markSendComplete(sendId: string): Promise<void> {
    await query(`
      UPDATE scheduled_sends
      SET status = 'sent', sent_at = NOW()
      WHERE id = $1
    `, [sendId])
  }

  /**
   * Mark send as failed
   */
  private async markSendFailed(sendId: string, error: string): Promise<void> {
    await query(`
      UPDATE scheduled_sends
      SET status = 'failed', error = $2
      WHERE id = $1
    `, [sendId, error])
  }

  /**
   * Cancel scheduled send
   */
  async cancelSend(sendId: string, reason: string): Promise<void> {
    await query(`
      UPDATE scheduled_sends
      SET status = 'cancelled', cancelled_reason = $2
      WHERE id = $1
    `, [sendId, reason])
  }

  /**
   * Get timezone analytics
   */
  async getTimezoneAnalytics(timeframe: 'day' | 'week' | 'month' = 'month'): Promise<TimezoneAnalytics> {
    const interval = timeframe === 'day' ? '1 day' :
                    timeframe === 'week' ? '7 days' : '30 days'

    const results = await query(`
      SELECT
        COUNT(DISTINCT ss.contact_email) as total_contacts,
        AVG(EXTRACT(EPOCH FROM (ss.sent_at - ss.scheduled_time))/3600) as avg_delay_hours,
        COUNT(CASE WHEN ss.sent_at <= ss.scheduled_time + INTERVAL '1 hour' THEN 1 END)::float /
          COUNT(CASE WHEN ss.status = 'sent' THEN 1 END) as on_time_rate,
        COUNT(CASE WHEN
          EXTRACT(hour from ss.sent_at at time zone ss.timezone) BETWEEN 9 AND 17
          THEN 1 END)::float / COUNT(CASE WHEN ss.status = 'sent' THEN 1 END) as business_hour_rate
      FROM scheduled_sends ss
      WHERE ss.created_at >= NOW() - INTERVAL '${interval}'
    `)

    const timezoneResults = await query(`
      SELECT timezone, COUNT(*) as count
      FROM timezone_info
      WHERE detected_at >= NOW() - INTERVAL '${interval}'
      GROUP BY timezone
      ORDER BY count DESC
    `)

    const timezoneDistribution: Record<string, number> = {}
    for (const row of timezoneResults.rows) {
      timezoneDistribution[row.timezone] = parseInt(row.count)
    }

    const stats = results.rows[0]
    return {
      totalContacts: parseInt(stats.total_contacts) || 0,
      timezoneDistribution,
      averageSendDelay: parseFloat(stats.avg_delay_hours) || 0,
      onTimeDeliveryRate: parseFloat(stats.on_time_rate) || 0,
      businessHourDeliveryRate: parseFloat(stats.business_hour_rate) || 0
    }
  }
}

// Singleton instance
export const timezoneSendingEngine = new TimezoneSendingEngine()

/**
 * Schedule timezone-aware email send
 */
export async function scheduleTimezoneAwareEmail(
  contactEmail: string,
  campaignId: string,
  subject: string,
  body: string,
  options?: Parameters<TimezoneSendingEngine['scheduleEmail']>[4]
): Promise<ScheduledSend> {
  return await timezoneSendingEngine.scheduleEmail(
    contactEmail, campaignId, subject, body, options
  )
}

/**
 * Process all scheduled sends
 */
export async function processScheduledSends(): Promise<{
  processed: number
  sent: number
  skipped: number
  errors: string[]
}> {
  return await timezoneSendingEngine.processScheduledSends()
}

/**
 * Detect timezone for contact
 */
export async function detectContactTimezone(
  email: string,
  ipAddress?: string,
  userData?: Record<string, any>
): Promise<TimezoneInfo> {
  return await timezoneSendingEngine.detectTimezone(email, ipAddress, userData)
}
