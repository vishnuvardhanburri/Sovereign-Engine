/**
 * Email Verification Layer
 * Integrates with ZeroBounce/NeverBounce APIs for email validation
 * Validates emails before sending to ensure deliverability
 */

import { appEnv } from '@/lib/env'
import { query } from '@/lib/db'

export interface EmailValidationResult {
  email: string
  isValid: boolean
  status: 'valid' | 'invalid' | 'unknown' | 'catch_all' | 'disposable'
  confidence: number
  provider: string
  checkedAt: Date
  error?: string
}

export interface ValidationStats {
  total: number
  valid: number
  invalid: number
  unknown: number
  catchAll: number
  disposable: number
  lastUpdated: Date
}

class EmailVerificationService {
  private readonly zerobounceApiKey: string
  private readonly neverbounceApiKey: string
  private readonly cache: Map<string, EmailValidationResult> = new Map()
  private readonly cacheExpiry: number = 24 * 60 * 60 * 1000 // 24 hours

  constructor() {
    this.zerobounceApiKey = appEnv.zeroBounceApiKey()
    this.neverbounceApiKey = appEnv.neverbounceApiKey?.() || ''
  }

  /**
   * Validate single email address
   */
  async validateEmail(email: string): Promise<EmailValidationResult> {
    // Check cache first
    const cached = this.getCachedResult(email)
    if (cached) return cached

    try {
      // Try ZeroBounce first (primary provider)
      if (this.zerobounceApiKey) {
        const result = await this.validateWithZeroBounce(email)
        this.setCache(email, result)
        return result
      }

      // Fallback to NeverBounce
      if (this.neverbounceApiKey) {
        const result = await this.validateWithNeverBounce(email)
        this.setCache(email, result)
        return result
      }

      // No API keys - basic validation only
      const result = this.basicValidation(email)
      this.setCache(email, result)
      return result

    } catch (error) {
      console.error('Email validation error:', error)
      const result: EmailValidationResult = {
        email,
        isValid: false,
        status: 'unknown',
        confidence: 0,
        provider: 'error',
        checkedAt: new Date(),
        error: error instanceof Error ? error.message : 'Unknown error'
      }
      this.setCache(email, result)
      return result
    }
  }

  /**
   * Validate batch of emails
   */
  async validateEmails(emails: string[]): Promise<EmailValidationResult[]> {
    const results: EmailValidationResult[] = []

    // Process in batches to avoid rate limits
    const batchSize = 100
    for (let i = 0; i < emails.length; i += batchSize) {
      const batch = emails.slice(i, i + batchSize)
      const batchResults = await Promise.all(
        batch.map(email => this.validateEmail(email))
      )
      results.push(...batchResults)

      // Small delay between batches to respect rate limits
      if (i + batchSize < emails.length) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    return results
  }

  /**
   * Validate email with ZeroBounce API
   */
  private async validateWithZeroBounce(email: string): Promise<EmailValidationResult> {
    const response = await fetch(`https://api.zerobounce.net/v2/validate?api_key=${this.zerobounceApiKey}&email=${encodeURIComponent(email)}`)

    if (!response.ok) {
      throw new Error(`ZeroBounce API error: ${response.status}`)
    }

    const data = await response.json()

    return {
      email,
      isValid: data.status === 'valid',
      status: this.mapZeroBounceStatus(data.status),
      confidence: this.mapZeroBounceScore(data.sub_status),
      provider: 'zerobounce',
      checkedAt: new Date()
    }
  }

  /**
   * Validate email with NeverBounce API
   */
  private async validateWithNeverBounce(email: string): Promise<EmailValidationResult> {
    const response = await fetch('https://api.neverbounce.com/v4/single/check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${this.neverbounceApiKey}:`).toString('base64')}`
      },
      body: JSON.stringify({ email })
    })

    if (!response.ok) {
      throw new Error(`NeverBounce API error: ${response.status}`)
    }

    const data = await response.json()

    return {
      email,
      isValid: data.result === 'valid',
      status: this.mapNeverBounceResult(data.result),
      confidence: this.mapNeverBounceScore(data.result),
      provider: 'neverbounce',
      checkedAt: new Date()
    }
  }

  /**
   * Basic email validation (regex + common checks)
   */
  private basicValidation(email: string): EmailValidationResult {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

    if (!emailRegex.test(email)) {
      return {
        email,
        isValid: false,
        status: 'invalid',
        confidence: 0.9,
        provider: 'basic',
        checkedAt: new Date()
      }
    }

    // Check for disposable domains
    const disposableDomains = ['10minutemail.com', 'guerrillamail.com', 'mailinator.com']
    const domain = email.split('@')[1]?.toLowerCase()

    if (disposableDomains.includes(domain)) {
      return {
        email,
        isValid: false,
        status: 'disposable',
        confidence: 0.95,
        provider: 'basic',
        checkedAt: new Date()
      }
    }

    return {
      email,
      isValid: true,
      status: 'valid',
      confidence: 0.5, // Low confidence for basic validation
      provider: 'basic',
      checkedAt: new Date()
    }
  }

  /**
   * Map ZeroBounce status to our unified status
   */
  private mapZeroBounceStatus(status: string): EmailValidationResult['status'] {
    switch (status) {
      case 'valid': return 'valid'
      case 'invalid': return 'invalid'
      case 'catch-all': return 'catch_all'
      case 'unknown': return 'unknown'
      default: return 'unknown'
    }
  }

  /**
   * Map ZeroBounce sub_status to confidence score
   */
  private mapZeroBounceScore(subStatus: string): number {
    switch (subStatus) {
      case 'antispam_system': return 0.95
      case 'greylisted': return 0.85
      case 'mailbox_full': return 0.80
      case 'role_based': return 0.90
      case 'possible_trap': return 0.70
      default: return 0.85
    }
  }

  /**
   * Map NeverBounce result to our unified status
   */
  private mapNeverBounceResult(result: string): EmailValidationResult['status'] {
    switch (result) {
      case 'valid': return 'valid'
      case 'invalid': return 'invalid'
      case 'catchall': return 'catch_all'
      case 'unknown': return 'unknown'
      default: return 'unknown'
    }
  }

  /**
   * Map NeverBounce result to confidence score
   */
  private mapNeverBounceScore(result: string): number {
    switch (result) {
      case 'valid': return 0.95
      case 'invalid': return 0.90
      case 'catchall': return 0.75
      case 'unknown': return 0.50
      default: return 0.50
    }
  }

  /**
   * Get cached validation result
   */
  private getCachedResult(email: string): EmailValidationResult | null {
    const cached = this.cache.get(email)
    if (!cached) return null

    // Check if cache is expired
    const age = Date.now() - cached.checkedAt.getTime()
    if (age > this.cacheExpiry) {
      this.cache.delete(email)
      return null
    }

    return cached
  }

  /**
   * Set validation result in cache
   */
  private setCache(email: string, result: EmailValidationResult): void {
    this.cache.set(email, result)

    // Limit cache size to prevent memory issues
    if (this.cache.size > 10000) {
      const oldestKey = this.cache.keys().next().value
      this.cache.delete(oldestKey)
    }
  }

  /**
   * Get validation statistics
   */
  async getValidationStats(): Promise<ValidationStats> {
    const results = await query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'valid' THEN 1 END) as valid,
        COUNT(CASE WHEN status = 'invalid' THEN 1 END) as invalid,
        COUNT(CASE WHEN status = 'unknown' THEN 1 END) as unknown,
        COUNT(CASE WHEN status = 'catch_all' THEN 1 END) as catch_all,
        COUNT(CASE WHEN status = 'disposable' THEN 1 END) as disposable,
        MAX(checked_at) as last_updated
      FROM email_validations
      WHERE checked_at >= NOW() - INTERVAL '30 days'
    `)

    const stats = results.rows[0]
    return {
      total: parseInt(stats.total) || 0,
      valid: parseInt(stats.valid) || 0,
      invalid: parseInt(stats.invalid) || 0,
      unknown: parseInt(stats.unknown) || 0,
      catchAll: parseInt(stats.catch_all) || 0,
      disposable: parseInt(stats.disposable) || 0,
      lastUpdated: stats.last_updated || new Date()
    }
  }

  /**
   * Store validation result in database
   */
  async storeValidationResult(result: EmailValidationResult): Promise<void> {
    await query(`
      INSERT INTO email_validations (
        email, is_valid, status, confidence, provider, checked_at, error
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (email) DO UPDATE SET
        is_valid = EXCLUDED.is_valid,
        status = EXCLUDED.status,
        confidence = EXCLUDED.confidence,
        provider = EXCLUDED.provider,
        checked_at = EXCLUDED.checked_at,
        error = EXCLUDED.error
    `, [
      result.email,
      result.isValid,
      result.status,
      result.confidence,
      result.provider,
      result.checkedAt,
      result.error || null
    ])
  }

  /**
   * Check if email is valid for sending
   */
  isValidForSending(result: EmailValidationResult): boolean {
    return result.isValid &&
           result.status === 'valid' &&
           result.confidence >= 0.8
  }
}

// Singleton instance
export const emailVerification = new EmailVerificationService()

/**
 * Validate email before sending (used by sending pipeline)
 */
export async function validateEmailForSending(email: string): Promise<boolean> {
  const result = await emailVerification.validateEmail(email)

  // Store result for analytics
  await emailVerification.storeValidationResult(result)

  return emailVerification.isValidForSending(result)
}

/**
 * Batch validate emails for campaign
 */
export async function validateEmailsForCampaign(emails: string[]): Promise<{
  valid: string[]
  invalid: string[]
  stats: ValidationStats
}> {
  const results = await emailVerification.validateEmails(emails)

  // Store all results
  await Promise.all(results.map(result =>
    emailVerification.storeValidationResult(result)
  ))

  const valid = results
    .filter(result => emailVerification.isValidForSending(result))
    .map(result => result.email)

  const invalid = results
    .filter(result => !emailVerification.isValidForSending(result))
    .map(result => result.email)

  const stats = await emailVerification.getValidationStats()

  return { valid, invalid, stats }
}