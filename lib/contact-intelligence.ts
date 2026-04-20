// @ts-nocheck
/**
 * Contact Intelligence System
 * Advanced contact management with duplicate detection, data enrichment, and scoring
 * Manages contact relationships, preferences, and engagement patterns
 */

import { appEnv } from '@/lib/env'
import { query } from '@/lib/db'
import crypto from 'crypto'

export interface Contact {
  id: string
  email: string
  firstName?: string
  lastName?: string
  company?: string
  title?: string
  phone?: string
  website?: string
  linkedinUrl?: string
  twitterHandle?: string
  location?: {
    city: string
    state: string
    country: string
    timezone: string
  }
  industry?: string
  companySize?: string
  revenue?: string
  enriched: boolean
  enrichmentSource?: string
  enrichmentDate?: Date
  createdAt: Date
  updatedAt: Date
  tags: string[]
  customFields: Record<string, any>
}

export interface ContactDuplicate {
  contactId: string
  duplicateId: string
  similarity: number // 0-1
  matchReasons: string[]
  detectedAt: Date
  resolved: boolean
  resolution?: 'merge' | 'keep_both' | 'delete_duplicate'
  resolvedAt?: Date
}

export interface ContactScore {
  contactId: string
  overallScore: number // 0-100
  engagementScore: number // 0-100
  demographicScore: number // 0-100
  behavioralScore: number // 0-100
  recencyScore: number // 0-100
  frequencyScore: number // 0-100
  lastCalculated: Date
  factors: {
    opens: number
    clicks: number
    replies: number
    unsubscribes: number
    bounces: number
    lastActivity: Date
    totalEmails: number
    industryMatch: boolean
    companySizeMatch: boolean
    titleMatch: boolean
  }
}

export interface ContactRelationship {
  contactId: string
  relatedContactId: string
  relationshipType: 'colleague' | 'manager' | 'direct_report' | 'client' | 'partner' | 'competitor'
  strength: number // 0-1
  source: string
  createdAt: Date
  lastUpdated: Date
}

export interface EnrichmentResult {
  success: boolean
  data?: Partial<Contact>
  confidence: number
  source: string
  cost?: number
  error?: string
}

export interface ContactAnalytics {
  totalContacts: number
  enrichedContacts: number
  enrichmentRate: number
  averageScore: number
  scoreDistribution: Record<string, number> // 'high', 'medium', 'low'
  industryBreakdown: Record<string, number>
  companySizeBreakdown: Record<string, number>
  geographicDistribution: Record<string, number>
  duplicateContacts: number
  duplicateResolutionRate: number
}

class ContactIntelligenceEngine {
  private readonly enrichmentProviders = {
    hunter: {
      apiKey: process.env.HUNTER_API_KEY,
      baseUrl: 'https://api.hunter.io/v2'
    },
    clearbit: {
      apiKey: process.env.CLEARBIT_API_KEY,
      baseUrl: 'https://person.clearbit.com/v2'
    },
    zoominfo: {
      apiKey: process.env.ZOOMINFO_API_KEY,
      baseUrl: 'https://api.zoominfo.com/v1'
    }
  }

  private readonly duplicateThreshold: number = 0.8 // 80% similarity
  private readonly scoreWeights = {
    engagement: 0.4,
    demographic: 0.3,
    behavioral: 0.2,
    recency: 0.05,
    frequency: 0.05
  }

  /**
   * Create or update contact
   */
  async upsertContact(contactData: Omit<Contact, 'id' | 'createdAt' | 'updatedAt' | 'enriched' | 'tags' | 'customFields'>): Promise<Contact> {
    const existing = await this.getContactByEmail(contactData.email)

    if (existing) {
      // Update existing contact
      const updated = await this.updateContact(existing.id, contactData)
      return updated
    } else {
      // Create new contact
      const created = await this.createContact(contactData)
      return created
    }
  }

  /**
   * Create new contact
   */
  private async createContact(contactData: Omit<Contact, 'id' | 'createdAt' | 'updatedAt' | 'enriched' | 'tags' | 'customFields'>): Promise<Contact> {
    const contactId = this.generateContactId()

    await query(`
      INSERT INTO contacts (
        id, email, first_name, last_name, company, title, phone,
        website, linkedin_url, twitter_handle, location_city,
        location_state, location_country, location_timezone,
        industry, company_size, revenue, enriched, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
    `, [
      contactId,
      contactData.email,
      contactData.firstName || null,
      contactData.lastName || null,
      contactData.company || null,
      contactData.title || null,
      contactData.phone || null,
      contactData.website || null,
      contactData.linkedinUrl || null,
      contactData.twitterHandle || null,
      contactData.location?.city || null,
      contactData.location?.state || null,
      contactData.location?.country || null,
      contactData.location?.timezone || null,
      contactData.industry || null,
      contactData.companySize || null,
      contactData.revenue || null,
      false,
      new Date(),
      new Date()
    ])

    return await this.getContactById(contactId)
  }

  /**
   * Update existing contact
   */
  private async updateContact(contactId: string, updates: Partial<Contact>): Promise<Contact> {
    const setParts: string[] = ['updated_at = NOW()']
    const values: any[] = []
    let paramIndex = 1

    const fieldMapping: Record<string, string> = {
      firstName: 'first_name',
      lastName: 'last_name',
      company: 'company',
      title: 'title',
      phone: 'phone',
      website: 'website',
      linkedinUrl: 'linkedin_url',
      twitterHandle: 'twitter_handle',
      industry: 'industry',
      companySize: 'company_size',
      revenue: 'revenue',
      enriched: 'enriched',
      enrichmentSource: 'enrichment_source',
      enrichmentDate: 'enrichment_date'
    }

    for (const [key, value] of Object.entries(updates)) {
      if (key === 'location' && value) {
        setParts.push(`location_city = $${paramIndex}`)
        values.push(value.city)
        paramIndex++

        setParts.push(`location_state = $${paramIndex}`)
        values.push(value.state)
        paramIndex++

        setParts.push(`location_country = $${paramIndex}`)
        values.push(value.country)
        paramIndex++

        setParts.push(`location_timezone = $${paramIndex}`)
        values.push(value.timezone)
        paramIndex++
      } else if (fieldMapping[key]) {
        setParts.push(`${fieldMapping[key]} = $${paramIndex}`)
        values.push(value)
        paramIndex++
      }
    }

    if (setParts.length === 1) return await this.getContactById(contactId)

    values.push(contactId)

    await query(`
      UPDATE contacts
      SET ${setParts.join(', ')}
      WHERE id = $${paramIndex}
    `, values)

    return await this.getContactById(contactId)
  }

  /**
   * Get contact by email
   */
  async getContactByEmail(email: string): Promise<Contact | null> {
    const result = await query('SELECT * FROM contacts WHERE email = $1', [email])
    if (result.rows.length === 0) return null

    return this.mapContactRow(result.rows[0])
  }

  /**
   * Get contact by ID
   */
  async getContactById(contactId: string): Promise<Contact | null> {
    const result = await query('SELECT * FROM contacts WHERE id = $1', [contactId])
    if (result.rows.length === 0) return null

    return this.mapContactRow(result.rows[0])
  }

  /**
   * Enrich contact data
   */
  async enrichContact(contactId: string): Promise<EnrichmentResult> {
    const contact = await this.getContactById(contactId)
    if (!contact) {
      return {
        success: false,
        confidence: 0,
        source: 'system',
        error: 'Contact not found'
      }
    }

    // Try multiple enrichment providers
    const providers = ['hunter', 'clearbit', 'zoominfo']
    let bestResult: EnrichmentResult | null = null

    for (const provider of providers) {
      try {
        const result = await this.enrichWithProvider(contact, provider)
        if (result.success && (!bestResult || result.confidence > bestResult.confidence)) {
          bestResult = result
        }
      } catch (error) {
        console.error(`Enrichment failed for ${provider}:`, error)
      }
    }

    if (bestResult?.success && bestResult.data) {
      // Update contact with enriched data
      await this.updateContact(contactId, {
        ...bestResult.data,
        enriched: true,
        enrichmentSource: bestResult.source,
        enrichmentDate: new Date()
      })

      return bestResult
    }

    return {
      success: false,
      confidence: 0,
      source: 'system',
      error: 'No enrichment data found'
    }
  }

  /**
   * Detect duplicate contacts
   */
  async detectDuplicates(contactId: string): Promise<ContactDuplicate[]> {
    const contact = await this.getContactById(contactId)
    if (!contact) return []

    const duplicates: ContactDuplicate[] = []

    // Get all contacts for comparison
    const allContacts = await query(`
      SELECT * FROM contacts
      WHERE id != $1
      AND (email LIKE $2 OR first_name = $3 OR last_name = $4 OR company = $5)
    `, [
      contactId,
      `%${contact.email.split('@')[1]}`, // Same domain
      contact.firstName,
      contact.lastName,
      contact.company
    ])

    for (const otherContact of allContacts.rows) {
      const similarity = this.calculateSimilarity(contact, this.mapContactRow(otherContact))
      const matchReasons = this.getMatchReasons(contact, this.mapContactRow(otherContact))

      if (similarity >= this.duplicateThreshold) {
        duplicates.push({
          contactId,
          duplicateId: otherContact.id,
          similarity,
          matchReasons,
          detectedAt: new Date(),
          resolved: false
        })
      }
    }

    // Store detected duplicates
    for (const duplicate of duplicates) {
      await this.storeDuplicate(duplicate)
    }

    return duplicates
  }

  /**
   * Calculate contact score
   */
  async calculateContactScore(contactId: string): Promise<ContactScore> {
    const contact = await this.getContactById(contactId)
    if (!contact) throw new Error('Contact not found')

    // Get engagement metrics
    const engagementMetrics = await this.getEngagementMetrics(contactId)

    // Calculate component scores
    const engagementScore = this.calculateEngagementScore(engagementMetrics)
    const demographicScore = this.calculateDemographicScore(contact)
    const behavioralScore = this.calculateBehavioralScore(engagementMetrics)
    const recencyScore = this.calculateRecencyScore(engagementMetrics.lastActivity)
    const frequencyScore = this.calculateFrequencyScore(engagementMetrics.totalEmails)

    // Calculate overall score
    const overallScore = Math.round(
      engagementScore * this.scoreWeights.engagement +
      demographicScore * this.scoreWeights.demographic +
      behavioralScore * this.scoreWeights.behavioral +
      recencyScore * this.scoreWeights.recency +
      frequencyScore * this.scoreWeights.frequency
    )

    const score: ContactScore = {
      contactId,
      overallScore,
      engagementScore,
      demographicScore,
      behavioralScore,
      recencyScore,
      frequencyScore,
      lastCalculated: new Date(),
      factors: engagementMetrics
    }

    // Store score
    await this.storeContactScore(score)

    return score
  }

  /**
   * Get contact analytics
   */
  async getContactAnalytics(): Promise<ContactAnalytics> {
    const totalResult = await query('SELECT COUNT(*) as count FROM contacts')
    const enrichedResult = await query('SELECT COUNT(*) as count FROM contacts WHERE enriched = true')
    const duplicateResult = await query('SELECT COUNT(*) as count FROM contact_duplicates WHERE resolved = false')

    const scoreResult = await query(`
      SELECT
        AVG(overall_score) as avg_score,
        COUNT(CASE WHEN overall_score >= 80 THEN 1 END) as high_count,
        COUNT(CASE WHEN overall_score >= 50 AND overall_score < 80 THEN 1 END) as medium_count,
        COUNT(CASE WHEN overall_score < 50 THEN 1 END) as low_count
      FROM contact_scores
    `)

    const industryResult = await query(`
      SELECT industry, COUNT(*) as count
      FROM contacts
      WHERE industry IS NOT NULL
      GROUP BY industry
      ORDER BY count DESC
      LIMIT 10
    `)

    const companySizeResult = await query(`
      SELECT company_size, COUNT(*) as count
      FROM contacts
      WHERE company_size IS NOT NULL
      GROUP BY company_size
      ORDER BY count DESC
    `)

    const geoResult = await query(`
      SELECT location_country, COUNT(*) as count
      FROM contacts
      WHERE location_country IS NOT NULL
      GROUP BY location_country
      ORDER BY count DESC
      LIMIT 10
    `)

    const totalContacts = parseInt(totalResult.rows[0].count)
    const enrichedContacts = parseInt(enrichedResult.rows[0].count)
    const duplicateContacts = parseInt(duplicateResult.rows[0].count)

    const scores = scoreResult.rows[0]
    const averageScore = parseFloat(scores.avg_score) || 0

    const scoreDistribution = {
      high: parseInt(scores.high_count) || 0,
      medium: parseInt(scores.medium_count) || 0,
      low: parseInt(scores.low_count) || 0
    }

    const industryBreakdown: Record<string, number> = {}
    for (const row of industryResult.rows) {
      industryBreakdown[row.industry] = parseInt(row.count)
    }

    const companySizeBreakdown: Record<string, number> = {}
    for (const row of companySizeResult.rows) {
      companySizeBreakdown[row.company_size] = parseInt(row.count)
    }

    const geographicDistribution: Record<string, number> = {}
    for (const row of geoResult.rows) {
      geographicDistribution[row.location_country] = parseInt(row.location)
    }

    return {
      totalContacts,
      enrichedContacts,
      enrichmentRate: totalContacts > 0 ? enrichedContacts / totalContacts : 0,
      averageScore,
      scoreDistribution,
      industryBreakdown,
      companySizeBreakdown,
      geographicDistribution,
      duplicateContacts,
      duplicateResolutionRate: 0 // Would need to calculate from resolved duplicates
    }
  }

  /**
   * Bulk enrich contacts
   */
  async bulkEnrichContacts(contactIds: string[]): Promise<{
    successful: number
    failed: number
    results: EnrichmentResult[]
  }> {
    const results: EnrichmentResult[] = []
    let successful = 0
    let failed = 0

    for (const contactId of contactIds) {
      try {
        const result = await this.enrichContact(contactId)
        results.push(result)

        if (result.success) {
          successful++
        } else {
          failed++
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000))
      } catch (error) {
        failed++
        results.push({
          success: false,
          confidence: 0,
          source: 'system',
          error: error.message
        })
      }
    }

    return { successful, failed, results }
  }

  /**
   * Resolve duplicate contacts
   */
  async resolveDuplicate(
    contactId: string,
    duplicateId: string,
    resolution: 'merge' | 'keep_both' | 'delete_duplicate'
  ): Promise<void> {
    if (resolution === 'merge') {
      await this.mergeContacts(contactId, duplicateId)
    } else if (resolution === 'delete_duplicate') {
      await this.deleteContact(duplicateId)
    }

    // Mark as resolved
    await query(`
      UPDATE contact_duplicates
      SET resolved = true, resolution = $1, resolved_at = NOW()
      WHERE contact_id = $2 AND duplicate_id = $3
    `, [resolution, contactId, duplicateId])
  }

  // Private helper methods

  private generateContactId(): string {
    return `contact_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
  }

  private mapContactRow(row: any): Contact {
    return {
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      company: row.company,
      title: row.title,
      phone: row.phone,
      website: row.website,
      linkedinUrl: row.linkedin_url,
      twitterHandle: row.twitter_handle,
      location: row.location_city ? {
        city: row.location_city,
        state: row.location_state,
        country: row.location_country,
        timezone: row.location_timezone
      } : undefined,
      industry: row.industry,
      companySize: row.company_size,
      revenue: row.revenue,
      enriched: row.enriched,
      enrichmentSource: row.enrichment_source,
      enrichmentDate: row.enrichment_date,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      tags: [], // Would need separate table
      customFields: {} // Would need separate table
    }
  }

  private async enrichWithProvider(contact: Contact, provider: string): Promise<EnrichmentResult> {
    switch (provider) {
      case 'hunter':
        return await this.enrichWithHunter(contact)
      case 'clearbit':
        return await this.enrichWithClearbit(contact)
      case 'zoominfo':
        return await this.enrichWithZoominfo(contact)
      default:
        throw new Error(`Unknown provider: ${provider}`)
    }
  }

  private async enrichWithHunter(contact: Contact): Promise<EnrichmentResult> {
    const apiKey = this.enrichmentProviders.hunter.apiKey
    if (!apiKey) throw new Error('Hunter API key not configured')

    const domain = contact.email.split('@')[1]
    const response = await fetch(`${this.enrichmentProviders.hunter.baseUrl}/domain-search?domain=${domain}&api_key=${apiKey}`)

    if (!response.ok) throw new Error(`Hunter API error: ${response.status}`)

    const data = await response.json()

    if (data.data && data.data.emails && data.data.emails.length > 0) {
      const emailData = data.data.emails[0]
      return {
        success: true,
        data: {
          firstName: emailData.first_name,
          lastName: emailData.last_name,
          company: data.data.organization,
          title: emailData.position,
          linkedinUrl: emailData.linkedin,
          twitterHandle: emailData.twitter
        },
        confidence: emailData.confidence_score / 100,
        source: 'hunter',
        cost: 0.01 // Hunter charges per request
      }
    }

    return {
      success: false,
      confidence: 0,
      source: 'hunter',
      error: 'No data found'
    }
  }

  private async enrichWithClearbit(contact: Contact): Promise<EnrichmentResult> {
    const apiKey = this.enrichmentProviders.clearbit.apiKey
    if (!apiKey) throw new Error('Clearbit API key not configured')

    const response = await fetch(`https://person.clearbit.com/v2/people/find?email=${contact.email}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    })

    if (!response.ok) {
      if (response.status === 404) {
        return {
          success: false,
          confidence: 0,
          source: 'clearbit',
          error: 'Person not found'
        }
      }
      throw new Error(`Clearbit API error: ${response.status}`)
    }

    const data = await response.json()

    return {
      success: true,
      data: {
        firstName: data.name?.givenName,
        lastName: data.name?.familyName,
        company: data.employment?.name,
        title: data.employment?.title,
        linkedinUrl: data.linkedin?.handle ? `https://linkedin.com/in/${data.linkedin.handle}` : undefined,
        twitterHandle: data.twitter?.handle,
        location: data.location ? {
          city: data.location.city,
          state: data.location.state,
          country: data.location.country,
          timezone: data.timeZone
        } : undefined,
        website: data.site
      },
      confidence: 0.9, // Clearbit is generally reliable
      source: 'clearbit',
      cost: 0.05 // Clearbit charges per lookup
    }
  }

  private async enrichWithZoominfo(contact: Contact): Promise<EnrichmentResult> {
    // ZoomInfo implementation would go here
    // This is a placeholder as ZoomInfo has complex authentication
    return {
      success: false,
      confidence: 0,
      source: 'zoominfo',
      error: 'Not implemented'
    }
  }

  private calculateSimilarity(contact1: Contact, contact2: Contact): number {
    let similarity = 0
    let factors = 0

    // Email domain similarity
    if (contact1.email.split('@')[1] === contact2.email.split('@')[1]) {
      similarity += 0.4
    }
    factors++

    // Name similarity
    if (contact1.firstName && contact2.firstName &&
        contact1.firstName.toLowerCase() === contact2.firstName.toLowerCase()) {
      similarity += 0.3
    }
    factors++

    // Company similarity
    if (contact1.company && contact2.company &&
        contact1.company.toLowerCase() === contact2.company.toLowerCase()) {
      similarity += 0.3
    }
    factors++

    return similarity / factors
  }

  private getMatchReasons(contact1: Contact, contact2: Contact): string[] {
    const reasons: string[] = []

    if (contact1.email.split('@')[1] === contact2.email.split('@')[1]) {
      reasons.push('same_email_domain')
    }

    if (contact1.firstName && contact2.firstName &&
        contact1.firstName.toLowerCase() === contact2.firstName.toLowerCase()) {
      reasons.push('same_first_name')
    }

    if (contact1.lastName && contact2.lastName &&
        contact1.lastName.toLowerCase() === contact2.lastName.toLowerCase()) {
      reasons.push('same_last_name')
    }

    if (contact1.company && contact2.company &&
        contact1.company.toLowerCase() === contact2.company.toLowerCase()) {
      reasons.push('same_company')
    }

    return reasons
  }

  private async getEngagementMetrics(contactId: string): Promise<ContactScore['factors']> {
    const result = await query(`
      SELECT
        COUNT(CASE WHEN event_type = 'open' THEN 1 END) as opens,
        COUNT(CASE WHEN event_type = 'click' THEN 1 END) as clicks,
        COUNT(CASE WHEN event_type = 'reply' THEN 1 END) as replies,
        COUNT(CASE WHEN event_type = 'unsubscribe' THEN 1 END) as unsubscribes,
        COUNT(CASE WHEN event_type = 'bounce' THEN 1 END) as bounces,
        MAX(timestamp) as last_activity,
        COUNT(DISTINCT email_id) as total_emails
      FROM email_events
      WHERE contact_email = (SELECT email FROM contacts WHERE id = $1)
    `, [contactId])

    const metrics = result.rows[0]
    return {
      opens: parseInt(metrics.opens) || 0,
      clicks: parseInt(metrics.clicks) || 0,
      replies: parseInt(metrics.replies) || 0,
      unsubscribes: parseInt(metrics.unsubscribes) || 0,
      bounces: parseInt(metrics.bounces) || 0,
      lastActivity: metrics.last_activity || new Date(0),
      totalEmails: parseInt(metrics.total_emails) || 0,
      industryMatch: false, // Would need campaign context
      companySizeMatch: false,
      titleMatch: false
    }
  }

  private calculateEngagementScore(metrics: ContactScore['factors']): number {
    const { opens, clicks, replies, unsubscribes, bounces, totalEmails } = metrics

    if (totalEmails === 0) return 50 // Neutral score for no activity

    const openRate = opens / totalEmails
    const clickRate = clicks / totalEmails
    const replyRate = replies / totalEmails
    const unsubscribeRate = unsubscribes / totalEmails
    const bounceRate = bounces / totalEmails

    // Weighted score
    let score = (openRate * 20) + (clickRate * 30) + (replyRate * 40) - (unsubscribeRate * 50) - (bounceRate * 60)
    score = Math.max(0, Math.min(100, score + 50)) // Normalize to 0-100

    return Math.round(score)
  }

  private calculateDemographicScore(contact: Contact): number {
    let score = 0
    let factors = 0

    if (contact.title) {
      score += 20
      factors++
    }

    if (contact.company) {
      score += 20
      factors++
    }

    if (contact.industry) {
      score += 15
      factors++
    }

    if (contact.companySize) {
      score += 15
      factors++
    }

    if (contact.location) {
      score += 10
      factors++
    }

    if (contact.linkedinUrl || contact.twitterHandle) {
      score += 10
      factors++
    }

    if (contact.enriched) {
      score += 10
      factors++
    }

    return factors > 0 ? Math.round(score / factors * factors) : 50
  }

  private calculateBehavioralScore(metrics: ContactScore['factors']): number {
    // Based on positive vs negative actions
    const positive = metrics.opens + metrics.clicks + metrics.replies
    const negative = metrics.unsubscribes + metrics.bounces

    const ratio = positive / (positive + negative + 1) // +1 to avoid division by zero
    return Math.round(ratio * 100)
  }

  private calculateRecencyScore(lastActivity: Date): number {
    const daysSinceActivity = (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60 * 24)

    if (daysSinceActivity <= 7) return 100
    if (daysSinceActivity <= 30) return 80
    if (daysSinceActivity <= 90) return 60
    if (daysSinceActivity <= 180) return 40
    return 20
  }

  private calculateFrequencyScore(totalEmails: number): number {
    if (totalEmails >= 10) return 100
    if (totalEmails >= 5) return 80
    if (totalEmails >= 2) return 60
    if (totalEmails >= 1) return 40
    return 20
  }

  private async storeDuplicate(duplicate: ContactDuplicate): Promise<void> {
    await query(`
      INSERT INTO contact_duplicates (
        contact_id, duplicate_id, similarity, match_reasons, detected_at, resolved
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (contact_id, duplicate_id) DO NOTHING
    `, [
      duplicate.contactId,
      duplicate.duplicateId,
      duplicate.similarity,
      JSON.stringify(duplicate.matchReasons),
      duplicate.detectedAt,
      duplicate.resolved
    ])
  }

  private async storeContactScore(score: ContactScore): Promise<void> {
    await query(`
      INSERT INTO contact_scores (
        contact_id, overall_score, engagement_score, demographic_score,
        behavioral_score, recency_score, frequency_score, last_calculated, factors
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (contact_id) DO UPDATE SET
        overall_score = EXCLUDED.overall_score,
        engagement_score = EXCLUDED.engagement_score,
        demographic_score = EXCLUDED.demographic_score,
        behavioral_score = EXCLUDED.behavioral_score,
        recency_score = EXCLUDED.recency_score,
        frequency_score = EXCLUDED.frequency_score,
        last_calculated = EXCLUDED.last_calculated,
        factors = EXCLUDED.factors
    `, [
      score.contactId,
      score.overallScore,
      score.engagementScore,
      score.demographicScore,
      score.behavioralScore,
      score.recencyScore,
      score.frequencyScore,
      score.lastCalculated,
      JSON.stringify(score.factors)
    ])
  }

  private async mergeContacts(primaryId: string, duplicateId: string): Promise<void> {
    // This would be complex - merge all related data
    // For now, just mark the duplicate as merged
    await query(`
      UPDATE contacts
      SET merged_into = $1, updated_at = NOW()
      WHERE id = $2
    `, [primaryId, duplicateId])
  }

  private async deleteContact(contactId: string): Promise<void> {
    // Soft delete
    await query(`
      UPDATE contacts
      SET deleted = true, updated_at = NOW()
      WHERE id = $1
    `, [contactId])
  }
}

// Singleton instance
export const contactIntelligence = new ContactIntelligenceEngine()

/**
 * Create or update contact
 */
export async function upsertContact(contactData: Omit<Contact, 'id' | 'createdAt' | 'updatedAt' | 'enriched' | 'tags' | 'customFields'>): Promise<Contact> {
  return await contactIntelligence.upsertContact(contactData)
}

/**
 * Enrich contact data
 */
export async function enrichContact(contactId: string): Promise<EnrichmentResult> {
  return await contactIntelligence.enrichContact(contactId)
}

/**
 * Calculate contact score
 */
export async function calculateContactScore(contactId: string): Promise<ContactScore> {
  return await contactIntelligence.calculateContactScore(contactId)
}

/**
 * Detect duplicate contacts
 */
export async function detectDuplicates(contactId: string): Promise<ContactDuplicate[]> {
  return await contactIntelligence.detectDuplicates(contactId)
}
