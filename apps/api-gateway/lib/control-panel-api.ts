// @ts-nocheck
/**
 * Control Panel APIs
 * REST endpoints for managing campaigns, sequences, contacts, and analytics
 * Provides full programmatic control over the outbound sales platform
 */

import { NextRequest, NextResponse } from 'next/server'
import { appEnv } from '@/lib/env'
import { query } from '@/lib/db'
import { ContactScore } from '@/lib/contact-intelligence'
import { TrackingAnalytics } from '@/lib/advanced-tracking'
import { ComplianceReport } from '@/lib/compliance'

// ===== CAMPAIGN MANAGEMENT =====

export interface Campaign {
  id: string
  name: string
  description?: string
  status: 'draft' | 'active' | 'paused' | 'completed'
  type: 'cold_outreach' | 'nurture' | 'follow_up'
  targetAudience: {
    industries?: string[]
    companySizes?: string[]
    locations?: string[]
    jobTitles?: string[]
  }
  emailTemplate: {
    subject: string
    body: string
    fromName: string
    fromEmail: string
  }
  sequenceId?: string
  abTestId?: string
  compliance: {
    physicalAddress: string
    unsubscribeLink: string
    consentRequired: boolean
  }
  analytics: {
    sent: number
    delivered: number
    opened: number
    clicked: number
    replied: number
    bounced: number
    unsubscribed: number
  }
  createdAt: Date
  updatedAt: Date
  createdBy: string
}

export interface CreateCampaignRequest {
  name: string
  description?: string
  type: Campaign['type']
  targetAudience?: Campaign['targetAudience']
  emailTemplate: Campaign['emailTemplate']
  sequenceId?: string
  abTestId?: string
  compliance: Campaign['compliance']
}

export interface UpdateCampaignRequest extends Partial<CreateCampaignRequest> {
  status?: Campaign['status']
}

// ===== SEQUENCE MANAGEMENT =====

export interface Sequence {
  id: string
  name: string
  description?: string
  status: 'draft' | 'active' | 'paused' | 'completed'
  steps: SequenceStep[]
  conditions: SequenceCondition[]
  analytics: {
    totalContacts: number
    activeContacts: number
    completedContacts: number
    avgCompletionTime: number
    conversionRate: number
  }
  createdAt: Date
  updatedAt: Date
  createdBy: string
}

export interface SequenceStep {
  id: string
  stepNumber: number
  delay: number // hours after previous step
  emailTemplate: {
    subject: string
    body: string
    fromName: string
    fromEmail: string
  }
  conditions?: SequenceCondition[]
  analytics: {
    sent: number
    delivered: number
    opened: number
    clicked: number
    replied: number
  }
}

export interface SequenceCondition {
  id: string
  type: 'opened' | 'clicked' | 'replied' | 'not_opened' | 'time_based'
  operator: 'and' | 'or'
  value?: any
  stepId?: string
}

export interface CreateSequenceRequest {
  name: string
  description?: string
  steps: Omit<SequenceStep, 'id' | 'analytics'>[]
  conditions?: Omit<SequenceCondition, 'id'>[]
}

// ===== CONTACT MANAGEMENT =====

export interface ContactList {
  id: string
  name: string
  description?: string
  source: 'upload' | 'api' | 'integration' | 'manual'
  totalContacts: number
  activeContacts: number
  tags: string[]
  filters: ContactFilter[]
  createdAt: Date
  updatedAt: Date
  createdBy: string
}

export interface ContactFilter {
  field: 'industry' | 'company_size' | 'location' | 'job_title' | 'score' | 'tag'
  operator: 'equals' | 'contains' | 'greater_than' | 'less_than' | 'in'
  value: any
}

export interface BulkContactUpload {
  contacts: Array<{
    email: string
    firstName?: string
    lastName?: string
    company?: string
    title?: string
    phone?: string
    location?: {
      city?: string
      state?: string
      country?: string
    }
    tags?: string[]
    customFields?: Record<string, any>
  }>
  listId?: string
  skipDuplicates: boolean
  enrichContacts: boolean
}

// ===== ANALYTICS & REPORTING =====

export interface DashboardMetrics {
  campaigns: {
    total: number
    active: number
    completed: number
    avgConversionRate: number
  }
  sequences: {
    total: number
    active: number
    completed: number
    avgCompletionRate: number
  }
  contacts: {
    total: number
    active: number
    enriched: number
    avgScore: number
  }
  emails: {
    sent: number
    delivered: number
    opened: number
    clicked: number
    replied: number
    bounced: number
    unsubscribed: number
  }
  performance: {
    deliveryRate: number
    openRate: number
    clickRate: number
    replyRate: number
    bounceRate: number
    unsubscribeRate: number
  }
}

export interface PerformanceReport {
  period: {
    start: Date
    end: Date
  }
  campaigns: Array<{
    campaignId: string
    campaignName: string
    metrics: TrackingAnalytics
    performance: {
      deliveryRate: number
      openRate: number
      clickRate: number
      replyRate: number
      bounceRate: number
      unsubscribeRate: number
    }
  }>
  sequences: Array<{
    sequenceId: string
    sequenceName: string
    metrics: {
      totalContacts: number
      activeContacts: number
      completedContacts: number
      avgCompletionTime: number
      conversionRate: number
    }
  }>
  recommendations: string[]
}

// ===== API ENDPOINTS =====

// Campaigns
export async function GET_campaigns(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const type = searchParams.get('type')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    let whereClause = ''
    const params: any[] = []
    let paramIndex = 1

    if (status) {
      whereClause += ` AND status = $${paramIndex}`
      params.push(status)
      paramIndex++
    }

    if (type) {
      whereClause += ` AND type = $${paramIndex}`
      params.push(type)
      paramIndex++
    }

    params.push(limit, offset)

    const campaigns = await query(`
      SELECT
        c.*,
        COALESCE(stats.sent, 0) as sent,
        COALESCE(stats.delivered, 0) as delivered,
        COALESCE(stats.opened, 0) as opened,
        COALESCE(stats.clicked, 0) as clicked,
        COALESCE(stats.replied, 0) as replied,
        COALESCE(stats.bounced, 0) as bounced,
        COALESCE(stats.unsubscribed, 0) as unsubscribed
      FROM campaigns c
      LEFT JOIN campaign_stats stats ON c.id = stats.campaign_id
      WHERE 1=1 ${whereClause}
      ORDER BY c.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, params)

    const result = campaigns.rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      type: row.type,
      targetAudience: JSON.parse(row.target_audience || '{}'),
      emailTemplate: JSON.parse(row.email_template || '{}'),
      sequenceId: row.sequence_id,
      abTestId: row.ab_test_id,
      compliance: JSON.parse(row.compliance || '{}'),
      analytics: {
        sent: parseInt(row.sent) || 0,
        delivered: parseInt(row.delivered) || 0,
        opened: parseInt(row.opened) || 0,
        clicked: parseInt(row.clicked) || 0,
        replied: parseInt(row.replied) || 0,
        bounced: parseInt(row.bounced) || 0,
        unsubscribed: parseInt(row.unsubscribed) || 0
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdBy: row.created_by
    }))

    return NextResponse.json({ campaigns: result })
  } catch (error) {
    console.error('Error fetching campaigns:', error)
    return NextResponse.json({ error: 'Failed to fetch campaigns' }, { status: 500 })
  }
}

export async function POST_campaigns(request: NextRequest) {
  try {
    const body: CreateCampaignRequest = await request.json()

    // Validate required fields
    if (!body.name || !body.emailTemplate || !body.compliance) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const campaignId = `campaign_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    await query(`
      INSERT INTO campaigns (
        id, name, description, status, type, target_audience,
        email_template, sequence_id, ab_test_id, compliance,
        created_at, updated_at, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `, [
      campaignId,
      body.name,
      body.description || null,
      'draft',
      body.type,
      JSON.stringify(body.targetAudience || {}),
      JSON.stringify(body.emailTemplate),
      body.sequenceId || null,
      body.abTestId || null,
      JSON.stringify(body.compliance),
      new Date(),
      new Date(),
      'api' // Would be actual user ID
    ])

    return NextResponse.json({ campaignId }, { status: 201 })
  } catch (error) {
    console.error('Error creating campaign:', error)
    return NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 })
  }
}

// Sequences
export async function GET_sequences(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    let whereClause = ''
    const params: any[] = []

    if (status) {
      whereClause = 'WHERE status = $1'
      params.push(status)
    }

    params.push(limit, offset)

    const sequences = await query(`
      SELECT * FROM sequences
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params)

    const result = sequences.rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      steps: JSON.parse(row.steps || '[]'),
      conditions: JSON.parse(row.conditions || '[]'),
      analytics: JSON.parse(row.analytics || '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdBy: row.created_by
    }))

    return NextResponse.json({ sequences: result })
  } catch (error) {
    console.error('Error fetching sequences:', error)
    return NextResponse.json({ error: 'Failed to fetch sequences' }, { status: 500 })
  }
}

export async function POST_sequences(request: NextRequest) {
  try {
    const body: CreateSequenceRequest = await request.json()

    if (!body.name || !body.steps || body.steps.length === 0) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const sequenceId = `sequence_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    await query(`
      INSERT INTO sequences (
        id, name, description, status, steps, conditions,
        analytics, created_at, updated_at, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      sequenceId,
      body.name,
      body.description || null,
      'draft',
      JSON.stringify(body.steps),
      JSON.stringify(body.conditions || []),
      JSON.stringify({
        totalContacts: 0,
        activeContacts: 0,
        completedContacts: 0,
        avgCompletionTime: 0,
        conversionRate: 0
      }),
      new Date(),
      new Date(),
      'api'
    ])

    return NextResponse.json({ sequenceId }, { status: 201 })
  } catch (error) {
    console.error('Error creating sequence:', error)
    return NextResponse.json({ error: 'Failed to create sequence' }, { status: 500 })
  }
}

// Contacts
export async function GET_contacts(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const listId = searchParams.get('listId')
    const enriched = searchParams.get('enriched')
    const minScore = searchParams.get('minScore')
    const limit = parseInt(searchParams.get('limit') || '100')
    const offset = parseInt(searchParams.get('offset') || '0')

    let whereClause = ''
    const params: any[] = []
    let paramIndex = 1

    if (listId) {
      whereClause += ` AND cl.list_id = $${paramIndex}`
      params.push(listId)
      paramIndex++
    }

    if (enriched === 'true') {
      whereClause += ` AND c.enriched = true`
    } else if (enriched === 'false') {
      whereClause += ` AND (c.enriched = false OR c.enriched IS NULL)`
    }

    if (minScore) {
      whereClause += ` AND COALESCE(cs.overall_score, 0) >= $${paramIndex}`
      params.push(parseInt(minScore))
      paramIndex++
    }

    params.push(limit, offset)

    const contacts = await query(`
      SELECT
        c.*,
        COALESCE(cs.overall_score, 0) as score,
        COALESCE(cs.engagement_score, 0) as engagement_score,
        COALESCE(cs.demographic_score, 0) as demographic_score,
        cl.list_id,
        cl.tags as list_tags
      FROM contacts c
      LEFT JOIN contact_scores cs ON c.id = cs.contact_id
      LEFT JOIN contact_list_members cl ON c.id = cl.contact_id
      WHERE 1=1 ${whereClause}
      ORDER BY c.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, params)

    const result = contacts.rows.map(row => ({
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
      score: parseInt(row.score) || 0,
      engagementScore: parseInt(row.engagement_score) || 0,
      demographicScore: parseInt(row.demographic_score) || 0,
      tags: row.list_tags ? JSON.parse(row.list_tags) : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))

    return NextResponse.json({ contacts: result })
  } catch (error) {
    console.error('Error fetching contacts:', error)
    return NextResponse.json({ error: 'Failed to fetch contacts' }, { status: 500 })
  }
}

export async function POST_contacts_upload(request: NextRequest) {
  try {
    const body: BulkContactUpload = await request.json()

    if (!body.contacts || body.contacts.length === 0) {
      return NextResponse.json({ error: 'No contacts provided' }, { status: 400 })
    }

    const results = {
      uploaded: 0,
      duplicates: 0,
      errors: 0,
      enriched: 0
    }

    for (const contactData of body.contacts) {
      try {
        // Check for duplicates
        if (body.skipDuplicates) {
          const existing = await query('SELECT id FROM contacts WHERE email = $1', [contactData.email])
          if (existing.rows.length > 0) {
            results.duplicates++
            continue
          }
        }

        // Create contact
        const { upsertContact } = await import('@/lib/contact-intelligence')
        await upsertContact({
          email: contactData.email,
          firstName: contactData.firstName,
          lastName: contactData.lastName,
          company: contactData.company,
          title: contactData.title,
          phone: contactData.phone,
          location: contactData.location
        })

        results.uploaded++

        // Enrich if requested
        if (body.enrichContacts) {
          const { enrichContact } = await import('@/lib/contact-intelligence')
          const contact = await query('SELECT id FROM contacts WHERE email = $1', [contactData.email])
          if (contact.rows.length > 0) {
            await enrichContact(contact.rows[0].id)
            results.enriched++
          }
        }

        // Add to list if specified
        if (body.listId) {
          await query(`
            INSERT INTO contact_list_members (contact_id, list_id, tags)
            SELECT c.id, $2, $3 FROM contacts c WHERE c.email = $1
            ON CONFLICT (contact_id, list_id) DO NOTHING
          `, [contactData.email, body.listId, JSON.stringify(contactData.tags || [])])
        }

      } catch (error) {
        console.error(`Error uploading contact ${contactData.email}:`, error)
        results.errors++
      }
    }

    return NextResponse.json(results, { status: 201 })
  } catch (error) {
    console.error('Error uploading contacts:', error)
    return NextResponse.json({ error: 'Failed to upload contacts' }, { status: 500 })
  }
}

// Analytics
export async function GET_analytics_dashboard(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const period = searchParams.get('period') || '30d'

    // Calculate date range
    const endDate = new Date()
    const startDate = new Date()

    switch (period) {
      case '7d':
        startDate.setDate(endDate.getDate() - 7)
        break
      case '30d':
        startDate.setDate(endDate.getDate() - 30)
        break
      case '90d':
        startDate.setDate(endDate.getDate() - 90)
        break
      default:
        startDate.setDate(endDate.getDate() - 30)
    }

    // Get campaign metrics
    const campaignMetrics = await query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        AVG(CASE WHEN status = 'completed' THEN conversion_rate END) as avg_conversion_rate
      FROM campaigns
    `)

    // Get sequence metrics
    const sequenceMetrics = await query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        AVG(completion_rate) as avg_completion_rate
      FROM sequences
    `)

    // Get contact metrics
    const contactMetrics = await query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
        COUNT(CASE WHEN enriched = true THEN 1 END) as enriched,
        AVG(COALESCE(overall_score, 0)) as avg_score
      FROM contacts
      LEFT JOIN contact_scores ON contacts.id = contact_scores.contact_id
    `)

    // Get email metrics
    const emailMetrics = await query(`
      SELECT
        SUM(sent) as sent,
        SUM(delivered) as delivered,
        SUM(opened) as opened,
        SUM(clicked) as clicked,
        SUM(replied) as replied,
        SUM(bounced) as bounced,
        SUM(unsubscribed) as unsubscribed
      FROM campaign_stats
      WHERE created_at >= $1 AND created_at <= $2
    `, [startDate, endDate])

    const cMetrics = campaignMetrics.rows[0]
    const sMetrics = sequenceMetrics.rows[0]
    const coMetrics = contactMetrics.rows[0]
    const eMetrics = emailMetrics.rows[0]

    const sent = parseInt(eMetrics.sent) || 0
    const delivered = parseInt(eMetrics.delivered) || 0
    const opened = parseInt(eMetrics.opened) || 0
    const clicked = parseInt(eMetrics.clicked) || 0
    const replied = parseInt(eMetrics.replied) || 0
    const bounced = parseInt(eMetrics.bounced) || 0
    const unsubscribed = parseInt(eMetrics.unsubscribed) || 0

    const dashboard: DashboardMetrics = {
      campaigns: {
        total: parseInt(cMetrics.total) || 0,
        active: parseInt(cMetrics.active) || 0,
        completed: parseInt(cMetrics.completed) || 0,
        avgConversionRate: parseFloat(cMetrics.avg_conversion_rate) || 0
      },
      sequences: {
        total: parseInt(sMetrics.total) || 0,
        active: parseInt(sMetrics.active) || 0,
        completed: parseInt(sMetrics.completed) || 0,
        avgCompletionRate: parseFloat(sMetrics.avg_completion_rate) || 0
      },
      contacts: {
        total: parseInt(coMetrics.total) || 0,
        active: parseInt(coMetrics.active) || 0,
        enriched: parseInt(coMetrics.enriched) || 0,
        avgScore: parseFloat(coMetrics.avg_score) || 0
      },
      emails: {
        sent,
        delivered,
        opened,
        clicked,
        replied,
        bounced,
        unsubscribed
      },
      performance: {
        deliveryRate: sent > 0 ? delivered / sent : 0,
        openRate: delivered > 0 ? opened / delivered : 0,
        clickRate: delivered > 0 ? clicked / delivered : 0,
        replyRate: delivered > 0 ? replied / delivered : 0,
        bounceRate: sent > 0 ? bounced / sent : 0,
        unsubscribeRate: delivered > 0 ? unsubscribed / delivered : 0
      }
    }

    return NextResponse.json(dashboard)
  } catch (error) {
    console.error('Error fetching dashboard analytics:', error)
    return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 })
  }
}

export async function GET_analytics_performance(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const startDate = new Date(searchParams.get('startDate') || Date.now() - 30 * 24 * 60 * 60 * 1000)
    const endDate = new Date(searchParams.get('endDate') || Date.now())

    // Get campaign performance
    const campaignPerformance = await query(`
      SELECT
        c.id, c.name,
        COALESCE(stats.sent, 0) as sent,
        COALESCE(stats.delivered, 0) as delivered,
        COALESCE(stats.opened, 0) as opened,
        COALESCE(stats.clicked, 0) as clicked,
        COALESCE(stats.replied, 0) as replied,
        COALESCE(stats.bounced, 0) as bounced,
        COALESCE(stats.unsubscribed, 0) as unsubscribed
      FROM campaigns c
      LEFT JOIN campaign_stats stats ON c.id = stats.campaign_id
      WHERE c.created_at >= $1 AND c.created_at <= $2
    `, [startDate, endDate])

    const campaigns = campaignPerformance.rows.map(row => {
      const sent = parseInt(row.sent) || 0
      const delivered = parseInt(row.delivered) || 0
      const opened = parseInt(row.opened) || 0
      const clicked = parseInt(row.clicked) || 0
      const replied = parseInt(row.replied) || 0
      const bounced = parseInt(row.bounced) || 0
      const unsubscribed = parseInt(row.unsubscribed) || 0

      return {
        campaignId: row.id,
        campaignName: row.name,
        metrics: {
          totalEmails: sent,
          delivered,
          opened,
          clicked,
          replied,
          bounced,
          unsubscribed,
          deliveryRate: sent > 0 ? delivered / sent : 0,
          openRate: delivered > 0 ? opened / delivered : 0,
          clickRate: delivered > 0 ? clicked / delivered : 0,
          replyRate: delivered > 0 ? replied / delivered : 0,
          bounceRate: sent > 0 ? bounced / sent : 0,
          unsubscribeRate: delivered > 0 ? unsubscribed / delivered : 0,
          topLinks: [], // Would need additional query
          geographicDistribution: {}, // Would need additional query
          deviceBreakdown: {} // Would need additional query
        } as TrackingAnalytics,
        performance: {
          deliveryRate: sent > 0 ? delivered / sent : 0,
          openRate: delivered > 0 ? opened / delivered : 0,
          clickRate: delivered > 0 ? clicked / delivered : 0,
          replyRate: delivered > 0 ? replied / delivered : 0,
          bounceRate: sent > 0 ? bounced / sent : 0,
          unsubscribeRate: delivered > 0 ? unsubscribed / delivered : 0
        }
      }
    })

    // Get sequence performance
    const sequencePerformance = await query(`
      SELECT
        s.id, s.name,
        COALESCE(s.analytics->>'totalContacts', '0') as total_contacts,
        COALESCE(s.analytics->>'activeContacts', '0') as active_contacts,
        COALESCE(s.analytics->>'completedContacts', '0') as completed_contacts,
        COALESCE(s.analytics->>'avgCompletionTime', '0') as avg_completion_time,
        COALESCE(s.analytics->>'conversionRate', '0') as conversion_rate
      FROM sequences s
      WHERE s.created_at >= $1 AND s.created_at <= $2
    `, [startDate, endDate])

    const sequences = sequencePerformance.rows.map(row => ({
      sequenceId: row.id,
      sequenceName: row.name,
      metrics: {
        totalContacts: parseInt(row.total_contacts) || 0,
        activeContacts: parseInt(row.active_contacts) || 0,
        completedContacts: parseInt(row.completed_contacts) || 0,
        avgCompletionTime: parseFloat(row.avg_completion_time) || 0,
        conversionRate: parseFloat(row.conversion_rate) || 0
      }
    }))

    const report: PerformanceReport = {
      period: { start: startDate, end: endDate },
      campaigns,
      sequences,
      recommendations: [
        'Focus on campaigns with high open rates',
        'Optimize send times for better delivery',
        'A/B test subject lines for better engagement',
        'Consider re-engagement campaigns for inactive contacts'
      ]
    }

    return NextResponse.json(report)
  } catch (error) {
    console.error('Error fetching performance report:', error)
    return NextResponse.json({ error: 'Failed to fetch performance report' }, { status: 500 })
  }
}

// Compliance
export async function GET_compliance_report(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const startDate = new Date(searchParams.get('startDate') || Date.now() - 30 * 24 * 60 * 60 * 1000)
    const endDate = new Date(searchParams.get('endDate') || Date.now())

    const { generateComplianceReport } = await import('@/lib/compliance')
    const report = await generateComplianceReport(startDate, endDate)

    return NextResponse.json(report)
  } catch (error) {
    console.error('Error generating compliance report:', error)
    return NextResponse.json({ error: 'Failed to generate compliance report' }, { status: 500 })
  }
}

// ===== UTILITY FUNCTIONS =====

/**
 * Validate API key from request headers
 */
export async function validateApiKey(request: NextRequest): Promise<boolean> {
  const apiKey = request.headers.get('x-api-key')
  if (!apiKey) return false

  // Check API key against database
  const result = await query('SELECT id FROM api_keys WHERE key = $1 AND active = true', [apiKey])
  return result.rows.length > 0
}

/**
 * Get user ID from API key
 */
export async function getUserFromApiKey(request: NextRequest): Promise<string | null> {
  const apiKey = request.headers.get('x-api-key')
  if (!apiKey) return null

  const result = await query('SELECT user_id FROM api_keys WHERE key = $1 AND active = true', [apiKey])
  return result.rows[0]?.user_id || null
}

/**
 * Rate limiting check
 */
export async function checkRateLimit(userId: string, endpoint: string): Promise<boolean> {
  // Simple rate limiting - could be enhanced with Redis
  const windowMs = 60 * 1000 // 1 minute
  const maxRequests = 100 // per minute

  const result = await query(`
    SELECT COUNT(*) as count
    FROM api_requests
    WHERE user_id = $1 AND endpoint = $2 AND timestamp > NOW() - INTERVAL '${windowMs} milliseconds'
  `, [userId, endpoint])

  return (parseInt(result.rows[0].count) || 0) < maxRequests
}

/**
 * Log API request
 */
export async function logApiRequest(userId: string, endpoint: string, method: string, statusCode: number): Promise<void> {
  await query(`
    INSERT INTO api_requests (user_id, endpoint, method, status_code, timestamp)
    VALUES ($1, $2, $3, $4, NOW())
  `, [userId, endpoint, method, statusCode])
}
