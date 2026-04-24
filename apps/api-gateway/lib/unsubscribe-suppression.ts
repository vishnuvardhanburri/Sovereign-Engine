// @ts-nocheck
/**
 * Unsubscribe & Suppression System
 * Global suppression list, unsubscribe link generation, and auto-processing
 * Ensures compliance and prevents sending to unsubscribed users
 */

import { appEnv } from '@/lib/env'
import { query } from '@/lib/db'
import crypto from 'crypto'

export interface UnsubscribeRecord {
  email: string
  campaignId?: string
  reason?: string
  unsubscribedAt: Date
  source: 'link' | 'reply' | 'manual' | 'bounce'
  userAgent?: string
  ipAddress?: string
}

export interface SuppressionRecord {
  email: string
  reason: string
  suppressedAt: Date
  suppressedBy: string
  expiresAt?: Date
  metadata?: Record<string, any>
}

export interface UnsubscribeLink {
  token: string
  email: string
  campaignId?: string
  expiresAt: Date
  createdAt: Date
}

class UnsubscribeSuppressionService {
  private readonly unsubscribeSecret: string
  private readonly appBaseUrl: string
  private readonly linkExpiryHours: number = 168 // 7 days

  constructor() {
    this.unsubscribeSecret = appEnv.unsubscribeSecret()
    this.appBaseUrl = appEnv.appBaseUrl()
  }

  /**
   * Generate unsubscribe link for email
   */
  generateUnsubscribeLink(email: string, campaignId?: string): UnsubscribeLink {
    const token = this.generateToken(email, campaignId)
    const expiresAt = new Date(Date.now() + this.linkExpiryHours * 60 * 60 * 1000)

    const link: UnsubscribeLink = {
      token,
      email,
      campaignId,
      expiresAt,
      createdAt: new Date()
    }

    // Store link for tracking
    this.storeUnsubscribeLink(link)

    return link
  }

  /**
   * Process unsubscribe request from link
   */
  async processUnsubscribe(token: string, userAgent?: string, ipAddress?: string): Promise<{
    success: boolean
    email?: string
    message: string
  }> {
    try {
      // Validate token
      const link = await this.validateUnsubscribeToken(token)
      if (!link) {
        return { success: false, message: 'Invalid or expired unsubscribe link' }
      }

      // Check if already unsubscribed
      const existing = await this.getUnsubscribeRecord(link.email)
      if (existing) {
        return { success: true, email: link.email, message: 'Already unsubscribed' }
      }

      // Add to unsubscribe list
      await this.addToUnsubscribes({
        email: link.email,
        campaignId: link.campaignId,
        reason: 'User clicked unsubscribe link',
        unsubscribedAt: new Date(),
        source: 'link',
        userAgent,
        ipAddress
      })

      // Add to global suppression
      await this.addToSuppression({
        email: link.email,
        reason: 'User unsubscribed via link',
        suppressedAt: new Date(),
        suppressedBy: 'system',
        metadata: { campaignId: link.campaignId, source: 'unsubscribe_link' }
      })

      return { success: true, email: link.email, message: 'Successfully unsubscribed' }

    } catch (error) {
      console.error('Unsubscribe processing error:', error)
      return { success: false, message: 'Error processing unsubscribe request' }
    }
  }

  /**
   * Process unsubscribe from email reply
   */
  async processUnsubscribeReply(email: string, replyContent: string, campaignId?: string): Promise<boolean> {
    try {
      // Check if reply contains unsubscribe keywords
      const unsubscribeKeywords = [
        'unsubscribe', 'stop', 'remove me', 'opt out', 'no more emails',
        'take me off', 'cancel subscription', 'stop sending'
      ]

      const content = replyContent.toLowerCase()
      const hasUnsubscribeIntent = unsubscribeKeywords.some(keyword =>
        content.includes(keyword)
      )

      if (!hasUnsubscribeIntent) {
        return false // Not an unsubscribe reply
      }

      // Add to unsubscribe list
      await this.addToUnsubscribes({
        email,
        campaignId,
        reason: 'Detected unsubscribe intent in reply',
        unsubscribedAt: new Date(),
        source: 'reply'
      })

      // Add to global suppression
      await this.addToSuppression({
        email,
        reason: 'Unsubscribe detected in email reply',
        suppressedAt: new Date(),
        suppressedBy: 'system',
        metadata: { campaignId, replyContent: replyContent.slice(0, 200) }
      })

      return true

    } catch (error) {
      console.error('Unsubscribe reply processing error:', error)
      return false
    }
  }

  /**
   * Check if email is unsubscribed
   */
  async isUnsubscribed(email: string): Promise<boolean> {
    const result = await query(`
      SELECT 1 FROM unsubscribes
      WHERE email = $1
      LIMIT 1
    `, [email])

    return result.rows.length > 0
  }

  /**
   * Check if email is suppressed
   */
  async isSuppressed(email: string): Promise<boolean> {
    const result = await query(`
      SELECT 1 FROM suppressions
      WHERE email = $1
      AND (expires_at IS NULL OR expires_at > NOW())
      LIMIT 1
    `, [email])

    return result.rows.length > 0
  }

  /**
   * Check if email can receive campaigns
   */
  async canReceiveEmail(email: string): Promise<boolean> {
    const [unsubscribed, suppressed] = await Promise.all([
      this.isUnsubscribed(email),
      this.isSuppressed(email)
    ])

    return !unsubscribed && !suppressed
  }

  /**
   * Add manual suppression
   */
  async addManualSuppression(email: string, reason: string, suppressedBy: string, expiresAt?: Date): Promise<void> {
    await this.addToSuppression({
      email,
      reason,
      suppressedAt: new Date(),
      suppressedBy,
      expiresAt,
      metadata: { source: 'manual' }
    })
  }

  /**
   * Remove suppression (for appeals)
   */
  async removeSuppression(email: string): Promise<boolean> {
    const result = await query(`
      DELETE FROM suppressions
      WHERE email = $1
      RETURNING 1
    `, [email])

    return result.rows.length > 0
  }

  /**
   * Get unsubscribe record
   */
  private async getUnsubscribeRecord(email: string): Promise<UnsubscribeRecord | null> {
    const result = await query(`
      SELECT * FROM unsubscribes
      WHERE email = $1
      ORDER BY unsubscribed_at DESC
      LIMIT 1
    `, [email])

    if (result.rows.length === 0) return null

    const row = result.rows[0]
    return {
      email: row.email,
      campaignId: row.campaign_id,
      reason: row.reason,
      unsubscribedAt: row.unsubscribed_at,
      source: row.source,
      userAgent: row.user_agent,
      ipAddress: row.ip_address
    }
  }

  /**
   * Add to unsubscribes table
   */
  private async addToUnsubscribes(record: UnsubscribeRecord): Promise<void> {
    await query(`
      INSERT INTO unsubscribes (
        email, campaign_id, reason, unsubscribed_at, source, user_agent, ip_address
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (email) DO NOTHING
    `, [
      record.email,
      record.campaignId || null,
      record.reason || null,
      record.unsubscribedAt,
      record.source,
      record.userAgent || null,
      record.ipAddress || null
    ])
  }

  /**
   * Add to suppressions table
   */
  private async addToSuppression(record: SuppressionRecord): Promise<void> {
    await query(`
      INSERT INTO suppressions (
        email, reason, suppressed_at, suppressed_by, expires_at, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (email) DO UPDATE SET
        reason = EXCLUDED.reason,
        suppressed_at = EXCLUDED.suppressed_at,
        suppressed_by = EXCLUDED.suppressed_by,
        expires_at = EXCLUDED.expires_at,
        metadata = EXCLUDED.metadata
    `, [
      record.email,
      record.reason,
      record.suppressedAt,
      record.suppressedBy,
      record.expiresAt || null,
      record.metadata ? JSON.stringify(record.metadata) : null
    ])
  }

  /**
   * Generate secure token for unsubscribe link
   */
  private generateToken(email: string, campaignId?: string): string {
    const payload = `${email}:${campaignId || ''}:${Date.now()}`
    const hmac = crypto.createHmac('sha256', this.unsubscribeSecret)
    hmac.update(payload)
    return hmac.digest('hex')
  }

  /**
   * Validate unsubscribe token
   */
  private async validateUnsubscribeToken(token: string): Promise<UnsubscribeLink | null> {
    // Get link from database
    const result = await query(`
      SELECT * FROM unsubscribe_links
      WHERE token = $1 AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1
    `, [token])

    return result.rows.length > 0 ? {
      token: result.rows[0].token,
      email: result.rows[0].email,
      campaignId: result.rows[0].campaign_id,
      expiresAt: result.rows[0].expires_at,
      createdAt: result.rows[0].created_at
    } : null
  }

  /**
   * Store unsubscribe link for tracking
   */
  private async storeUnsubscribeLink(link: UnsubscribeLink): Promise<void> {
    await query(`
      INSERT INTO unsubscribe_links (
        token, email, campaign_id, expires_at, created_at
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (token) DO UPDATE SET
        expires_at = EXCLUDED.expires_at
    `, [
      link.token,
      link.email,
      link.campaignId || null,
      link.expiresAt,
      link.createdAt
    ])
  }

  /**
   * Get unsubscribe statistics
   */
  async getUnsubscribeStats(timeframe: 'day' | 'week' | 'month' = 'month'): Promise<{
    totalUnsubscribes: number
    bySource: Record<string, number>
    byCampaign: Record<string, number>
    suppressionCount: number
  }> {
    const interval = timeframe === 'day' ? '1 day' :
                    timeframe === 'week' ? '7 days' : '30 days'

    const unsubscribes = await query(`
      SELECT
        COUNT(*) as total,
        source,
        campaign_id
      FROM unsubscribes
      WHERE unsubscribed_at >= NOW() - INTERVAL '${interval}'
      GROUP BY source, campaign_id
    `)

    const suppressions = await query(`
      SELECT COUNT(*) as count
      FROM suppressions
      WHERE suppressed_at >= NOW() - INTERVAL '${interval}'
    `)

    const bySource: Record<string, number> = {}
    const byCampaign: Record<string, number> = {}

    for (const row of unsubscribes.rows) {
      bySource[row.source] = (bySource[row.source] || 0) + parseInt(row.total)
      if (row.campaign_id) {
        byCampaign[row.campaign_id] = (byCampaign[row.campaign_id] || 0) + parseInt(row.total)
      }
    }

    return {
      totalUnsubscribes: unsubscribes.rows.reduce((sum, row) => sum + parseInt(row.total), 0),
      bySource,
      byCampaign,
      suppressionCount: parseInt(suppressions.rows[0]?.count) || 0
    }
  }

  /**
   * Clean up expired unsubscribe links
   */
  async cleanupExpiredLinks(): Promise<number> {
    const result = await query(`
      DELETE FROM unsubscribe_links
      WHERE expires_at < NOW()
    `)

    return result.rowCount || 0
  }

  /**
   * Get full unsubscribe URL
   */
  getUnsubscribeUrl(link: UnsubscribeLink): string {
    return `${this.appBaseUrl}/api/unsubscribe/${link.token}`
  }
}

// Singleton instance
export const unsubscribeSuppression = new UnsubscribeSuppressionService()

/**
 * Check if email can receive campaigns (used by sending pipeline)
 */
export async function canSendToEmail(email: string): Promise<boolean> {
  return await unsubscribeSuppression.canReceiveEmail(email)
}

/**
 * Generate unsubscribe link for email
 */
export function generateUnsubscribeLink(email: string, campaignId?: string): {
  link: UnsubscribeLink
  url: string
} {
  const link = unsubscribeSuppression.generateUnsubscribeLink(email, campaignId)
  const url = unsubscribeSuppression.getUnsubscribeUrl(link)

  return { link, url }
}

/**
 * Process unsubscribe from email reply (used by reply processing)
 */
export async function processUnsubscribeFromReply(
  email: string,
  replyContent: string,
  campaignId?: string
): Promise<boolean> {
  return await unsubscribeSuppression.processUnsubscribeReply(email, replyContent, campaignId)
}

/**
 * Filter email list to remove unsubscribed/suppressed emails
 */
export async function filterSendableEmails(emails: string[]): Promise<{
  sendable: string[]
  blocked: string[]
  reasons: Record<string, string>
}> {
  const sendable: string[] = []
  const blocked: string[] = []
  const reasons: Record<string, string> = {}

  for (const email of emails) {
    const canSend = await canSendToEmail(email)
    if (canSend) {
      sendable.push(email)
    } else {
      blocked.push(email)
      const unsubscribed = await unsubscribeSuppression.isUnsubscribed(email)
      reasons[email] = unsubscribed ? 'unsubscribed' : 'suppressed'
    }
  }

  return { sendable, blocked, reasons }
}
