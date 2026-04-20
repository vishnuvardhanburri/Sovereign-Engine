// @ts-nocheck
import crypto from 'node:crypto'
import { appEnv } from '@/lib/env'
import { query, queryOne, transaction } from '@/lib/db'
import { Contact } from '@/lib/db/types'

function sign(payload: string) {
  return crypto
    .createHmac('sha256', appEnv.unsubscribeSecret())
    .update(payload)
    .digest('hex')
}

export function createUnsubscribeToken(input: {
  clientId: number
  contactId: number
  campaignId?: number | null
}) {
  const payload = `${input.clientId}:${input.contactId}:${input.campaignId ?? 0}`
  const signature = sign(payload)
  return Buffer.from(`${payload}:${signature}`).toString('base64url')
}

export function parseUnsubscribeToken(token: string) {
  const decoded = Buffer.from(token, 'base64url').toString('utf8')
  const [clientId, contactId, campaignId, signature] = decoded.split(':')
  const payload = `${clientId}:${contactId}:${campaignId}`

  if (!signature || sign(payload) !== signature) {
    throw new Error('Invalid unsubscribe token')
  }

  return {
    clientId: Number(clientId),
    contactId: Number(contactId),
    campaignId: Number(campaignId) || null,
  }
}

export function buildUnsubscribeUrl(input: {
  clientId: number
  contactId: number
  campaignId?: number | null
}) {
  const token = createUnsubscribeToken(input)
  return `${appEnv.appBaseUrl().replace(/\/$/, '')}/api/unsubscribe/${token}`
}

export async function markContactUnsubscribed(input: {
  clientId: number
  contactId: number
  reason?: string
  source?: string
}) {
  return transaction(async (executor) => {
    const contact = await executor<Contact>(
      `UPDATE contacts
       SET status = 'unsubscribed',
           unsubscribed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE client_id = $1 AND id = $2
       RETURNING *`,
      [input.clientId, input.contactId]
    )

    const row = contact.rows[0]
    if (!row) {
      return null
    }

    await executor(
      `INSERT INTO suppression_list (client_id, email, reason, source)
       VALUES ($1, $2, 'unsubscribed', $3)
       ON CONFLICT (client_id, email) DO UPDATE
       SET reason = 'unsubscribed',
           source = EXCLUDED.source`,
      [input.clientId, row.email, input.source ?? input.reason ?? 'unsubscribe']
    )

    await executor(
      `INSERT INTO events (
         client_id,
         campaign_id,
         contact_id,
         event_type,
         metadata
       )
       VALUES ($1, $2, $3, 'unsubscribed', $4)`,
      [input.clientId, null, input.contactId, { reason: input.reason ?? 'unsubscribe' }]
    )

    return row
  })
}

export async function suppressEmail(input: {
  clientId: number
  email: string
  reason: 'unsubscribed' | 'bounced' | 'duplicate' | 'complaint' | 'manual'
  source?: string | null
}) {
  await query(
    `INSERT INTO suppression_list (client_id, email, reason, source)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (client_id, email) DO UPDATE
     SET reason = EXCLUDED.reason,
         source = EXCLUDED.source`,
    [input.clientId, input.email.trim().toLowerCase(), input.reason, input.source ?? null]
  )
}

export async function findContactByProviderMessageId(providerMessageId: string) {
  return queryOne<{
    client_id: number
    contact_id: number | null
    campaign_id: number | null
    identity_id: number | null
    domain_id: number | null
    queue_job_id: number | null
  }>(
    `SELECT
       client_id,
       contact_id,
       campaign_id,
       identity_id,
       domain_id,
       queue_job_id
     FROM events
     WHERE provider_message_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [providerMessageId]
  )
}

// ===== ADVANCED COMPLIANCE SYSTEM =====

export interface ConsentRecord {
  id: string
  contactId: string
  consentType: 'marketing' | 'transactional' | 'survey' | 'third_party'
  consented: boolean
  consentSource: 'website' | 'email' | 'phone' | 'in_person' | 'implied'
  consentDate: Date
  expiryDate?: Date
  ipAddress?: string
  userAgent?: string
  consentText: string
  withdrawn: boolean
  withdrawnDate?: Date
  withdrawalReason?: string
}

export interface ComplianceViolation {
  id: string
  contactId: string
  campaignId?: string
  violationType: 'no_consent' | 'expired_consent' | 'unsubscribed' | 'spam_complaint' | 'data_retention' | 'gdpr_violation'
  severity: 'low' | 'medium' | 'high' | 'critical'
  description: string
  detectedAt: Date
  resolved: boolean
  resolvedAt?: Date
  resolution?: string
  penalty?: {
    type: 'fine' | 'warning' | 'block'
    amount?: number
    description: string
  }
}

export interface DataSubjectRequest {
  id: string
  contactId: string
  requestType: 'access' | 'rectification' | 'erasure' | 'portability' | 'restriction' | 'objection'
  status: 'pending' | 'processing' | 'completed' | 'rejected'
  requestedAt: Date
  completedAt?: Date
  response?: string
  ipAddress: string
  userAgent: string
  verificationToken: string
}

export interface ComplianceReport {
  period: {
    start: Date
    end: Date
  }
  metrics: {
    totalContacts: number
    consentedContacts: number
    consentRate: number
    unsubscribedContacts: number
    unsubscribeRate: number
    violations: number
    resolvedViolations: number
    dataDeletionRequests: number
    avgResponseTime: number // hours
  }
  violations: ComplianceViolation[]
  recommendations: string[]
  compliance: {
    gdpr: boolean
    canspam: boolean
    ccpa: boolean
    overall: boolean
  }
}

class AdvancedComplianceEngine {
  private readonly retentionPolicies = [
    {
      dataType: 'contact',
      retentionPeriod: 2555, // 7 years for GDPR
      autoDelete: false,
      legalBasis: 'GDPR Article 6(1)(f) - Legitimate Interest'
    },
    {
      dataType: 'email_log',
      retentionPeriod: 1095, // 3 years
      autoDelete: true,
      legalBasis: 'Business record retention'
    },
    {
      dataType: 'event',
      retentionPeriod: 730, // 2 years
      autoDelete: true,
      legalBasis: 'Analytics and performance monitoring'
    }
  ]

  /**
   * Record consent for contact
   */
  async recordConsent(
    contactId: string,
    consentType: ConsentRecord['consentType'],
    consented: boolean,
    consentSource: ConsentRecord['consentSource'],
    consentText: string,
    options: {
      expiryDate?: Date
      ipAddress?: string
      userAgent?: string
    } = {}
  ): Promise<ConsentRecord> {
    const consentId = this.generateConsentId()

    await query(`
      INSERT INTO consent_records (
        id, contact_id, consent_type, consented, consent_source,
        consent_date, expiry_date, ip_address, user_agent,
        consent_text, withdrawn
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [
      consentId,
      contactId,
      consentType,
      consented,
      consentSource,
      new Date(),
      options.expiryDate || null,
      options.ipAddress || null,
      options.userAgent || null,
      consentText,
      false
    ])

    return await this.getConsentRecord(consentId)
  }

  /**
   * Check if contact has valid consent for email type
   */
  async hasValidConsent(contactId: string, emailType: 'marketing' | 'transactional'): Promise<boolean> {
    const result = await query(`
      SELECT id FROM consent_records
      WHERE contact_id = $1
      AND consent_type = $2
      AND consented = true
      AND withdrawn = false
      AND (expiry_date IS NULL OR expiry_date > NOW())
      ORDER BY consent_date DESC
      LIMIT 1
    `, [contactId, emailType])

    return result.rows.length > 0
  }

  /**
   * Check compliance before sending email
   */
  async checkComplianceBeforeSend(
    contactEmail: string,
    campaignId: string,
    emailType: 'marketing' | 'transactional' = 'marketing'
  ): Promise<{
    compliant: boolean
    violations: ComplianceViolation[]
    warnings: string[]
  }> {
    const violations: ComplianceViolation[] = []
    const warnings: string[] = []

    // Get contact ID
    const contactResult = await query('SELECT id FROM contacts WHERE email = $1', [contactEmail])
    if (contactResult.rows.length === 0) {
      violations.push({
        id: this.generateViolationId(),
        contactId: 'unknown',
        campaignId,
        violationType: 'no_consent',
        severity: 'high',
        description: 'Contact not found in database - cannot verify consent',
        detectedAt: new Date(),
        resolved: false
      })
      return { compliant: false, violations, warnings }
    }

    const contactId = contactResult.rows[0].id

    // Check consent
    const hasConsent = await this.hasValidConsent(contactId, emailType)
    if (!hasConsent) {
      violations.push({
        id: this.generateViolationId(),
        contactId,
        campaignId,
        violationType: 'no_consent',
        severity: 'critical',
        description: `No valid ${emailType} consent found for contact`,
        detectedAt: new Date(),
        resolved: false
      })
    }

    // Check for unsubscribes
    const { canSendToEmail } = await import('@/lib/unsubscribe-suppression')
    const canSend = await canSendToEmail(contactEmail)
    if (!canSend) {
      violations.push({
        id: this.generateViolationId(),
        contactId,
        campaignId,
        violationType: 'unsubscribed',
        severity: 'critical',
        description: 'Contact has unsubscribed from marketing emails',
        detectedAt: new Date(),
        resolved: false
      })
    }

    // Check CAN-SPAM compliance
    const canSpamCompliant = await this.checkCanSpamCompliance(campaignId)
    if (!canSpamCompliant.compliant) {
      violations.push(...canSpamCompliant.violations)
    }

    // Store violations
    for (const violation of violations) {
      await this.storeViolation(violation)
    }

    return {
      compliant: violations.length === 0,
      violations,
      warnings
    }
  }

  /**
   * Handle data subject request (GDPR)
   */
  async handleDataSubjectRequest(
    contactEmail: string,
    requestType: DataSubjectRequest['requestType'],
    ipAddress: string,
    userAgent: string
  ): Promise<DataSubjectRequest> {
    // Find contact
    const contactResult = await query('SELECT id FROM contacts WHERE email = $1', [contactEmail])
    if (contactResult.rows.length === 0) {
      throw new Error('Contact not found')
    }

    const contactId = contactResult.rows[0].id
    const requestId = this.generateRequestId()
    const verificationToken = this.generateVerificationToken()

    // Create request record
    await query(`
      INSERT INTO data_subject_requests (
        id, contact_id, request_type, status, requested_at,
        ip_address, user_agent, verification_token
      ) VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7)
    `, [
      requestId,
      contactId,
      requestType,
      new Date(),
      ipAddress,
      userAgent,
      verificationToken
    ])

    // Send verification email
    await this.sendVerificationEmail(contactEmail, requestId, verificationToken, requestType)

    return await this.getDataSubjectRequest(requestId)
  }

  /**
   * Generate compliance report
   */
  async generateComplianceReport(
    startDate: Date,
    endDate: Date
  ): Promise<ComplianceReport> {
    // Get metrics
    const metricsResult = await query(`
      SELECT
        COUNT(DISTINCT c.id) as total_contacts,
        COUNT(DISTINCT CASE WHEN cr.consented = true AND cr.withdrawn = false THEN c.id END) as consented_contacts,
        COUNT(DISTINCT CASE WHEN s.email IS NOT NULL THEN c.id END) as unsubscribed_contacts,
        COUNT(cv.id) as violations,
        COUNT(CASE WHEN cv.resolved = true THEN 1 END) as resolved_violations,
        COUNT(dsr.id) as data_requests,
        AVG(EXTRACT(EPOCH FROM (dsr.completed_at - dsr.requested_at))/3600) as avg_response_time
      FROM contacts c
      LEFT JOIN consent_records cr ON c.id = cr.contact_id AND cr.consent_type = 'marketing'
      LEFT JOIN suppression_list s ON c.email = s.email
      LEFT JOIN compliance_violations cv ON c.id = cv.contact_id
        AND cv.detected_at BETWEEN $1 AND $2
      LEFT JOIN data_subject_requests dsr ON c.id = dsr.contact_id
        AND dsr.requested_at BETWEEN $1 AND $2
    `, [startDate, endDate])

    const metrics = metricsResult.rows[0]
    const totalContacts = parseInt(metrics.total_contacts) || 0
    const consentedContacts = parseInt(metrics.consented_contacts) || 0
    const unsubscribedContacts = parseInt(metrics.unsubscribed_contacts) || 0

    // Get violations
    const violationsResult = await query(`
      SELECT * FROM compliance_violations
      WHERE detected_at BETWEEN $1 AND $2
      ORDER BY detected_at DESC
    `, [startDate, endDate])

    const violations = violationsResult.rows.map(row => ({
      id: row.id,
      contactId: row.contact_id,
      campaignId: row.campaign_id,
      violationType: row.violation_type,
      severity: row.severity,
      description: row.description,
      detectedAt: row.detected_at,
      resolved: row.resolved,
      resolvedAt: row.resolved_at,
      resolution: row.resolution,
      penalty: row.penalty ? JSON.parse(row.penalty) : undefined
    }))

    // Check compliance status
    const compliance = await this.checkOverallCompliance()

    return {
      period: { start: startDate, end: endDate },
      metrics: {
        totalContacts,
        consentedContacts,
        consentRate: totalContacts > 0 ? consentedContacts / totalContacts : 0,
        unsubscribedContacts,
        unsubscribeRate: totalContacts > 0 ? unsubscribedContacts / totalContacts : 0,
        violations: parseInt(metrics.violations) || 0,
        resolvedViolations: parseInt(metrics.resolved_violations) || 0,
        dataDeletionRequests: parseInt(metrics.data_requests) || 0,
        avgResponseTime: parseFloat(metrics.avg_response_time) || 0
      },
      violations,
      recommendations: this.generateRecommendations(violations, compliance),
      compliance
    }
  }

  // Private helper methods

  private generateConsentId(): string {
    return `consent_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
  }

  private generateViolationId(): string {
    return `violation_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
  }

  private generateRequestId(): string {
    return `dsr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
  }

  private generateVerificationToken(): string {
    return crypto.randomBytes(32).toString('hex')
  }

  private async getConsentRecord(consentId: string): Promise<ConsentRecord> {
    const result = await query('SELECT * FROM consent_records WHERE id = $1', [consentId])
    if (result.rows.length === 0) throw new Error('Consent record not found')

    const row = result.rows[0]
    return {
      id: row.id,
      contactId: row.contact_id,
      consentType: row.consent_type,
      consented: row.consented,
      consentSource: row.consent_source,
      consentDate: row.consent_date,
      expiryDate: row.expiry_date,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      consentText: row.consent_text,
      withdrawn: row.withdrawn,
      withdrawnDate: row.withdrawn_date,
      withdrawalReason: row.withdrawal_reason
    }
  }

  private async checkCanSpamCompliance(campaignId: string): Promise<{
    compliant: boolean
    violations: ComplianceViolation[]
  }> {
    const violations: ComplianceViolation[] = []

    // Check if campaign has required elements
    const campaignResult = await query('SELECT * FROM campaigns WHERE id = $1', [campaignId])
    if (campaignResult.rows.length === 0) {
      violations.push({
        id: this.generateViolationId(),
        contactId: 'unknown',
        campaignId,
        violationType: 'gdpr_violation',
        severity: 'high',
        description: 'Campaign not found - cannot verify CAN-SPAM compliance',
        detectedAt: new Date(),
        resolved: false
      })
      return { compliant: false, violations }
    }

    const campaign = campaignResult.rows[0]

    // Check for physical mailing address
    if (!campaign.physical_address) {
      violations.push({
        id: this.generateViolationId(),
        contactId: 'unknown',
        campaignId,
        violationType: 'gdpr_violation',
        severity: 'medium',
        description: 'Missing physical mailing address (CAN-SPAM requirement)',
        detectedAt: new Date(),
        resolved: false
      })
    }

    // Check for unsubscribe link
    if (!campaign.unsubscribe_link) {
      violations.push({
        id: this.generateViolationId(),
        contactId: 'unknown',
        campaignId,
        violationType: 'gdpr_violation',
        severity: 'critical',
        description: 'Missing unsubscribe link (CAN-SPAM requirement)',
        detectedAt: new Date(),
        resolved: false
      })
    }

    return {
      compliant: violations.length === 0,
      violations
    }
  }

  private async checkOverallCompliance(): Promise<{
    gdpr: boolean
    canspam: boolean
    ccpa: boolean
    overall: boolean
  }> {
    // Simplified compliance checks
    const gdprViolations = await query(`
      SELECT COUNT(*) as count FROM compliance_violations
      WHERE violation_type = 'gdpr_violation' AND resolved = false
    `)

    const canSpamViolations = await query(`
      SELECT COUNT(*) as count FROM compliance_violations
      WHERE violation_type IN ('no_consent', 'unsubscribed') AND resolved = false
    `)

    return {
      gdpr: parseInt(gdprViolations.rows[0].count) === 0,
      canspam: parseInt(canSpamViolations.rows[0].count) === 0,
      ccpa: true, // Simplified - would need more complex checks
      overall: parseInt(gdprViolations.rows[0].count) === 0 && parseInt(canSpamViolations.rows[0].count) === 0
    }
  }

  private generateRecommendations(
    violations: ComplianceViolation[],
    compliance: any
  ): string[] {
    const recommendations: string[] = []

    if (!compliance.gdpr) {
      recommendations.push('Review and update GDPR consent mechanisms')
      recommendations.push('Implement proper data subject request handling')
    }

    if (!compliance.canspam) {
      recommendations.push('Ensure all emails include physical mailing address')
      recommendations.push('Verify unsubscribe links are working and processed within 10 days')
    }

    if (violations.length > 10) {
      recommendations.push('Implement automated compliance monitoring and alerting')
    }

    return recommendations
  }

  private async sendVerificationEmail(
    email: string,
    requestId: string,
    token: string,
    requestType: string
  ): Promise<void> {
    const verificationUrl = `${appEnv.appBaseUrl()}/api/compliance/verify-request/${requestId}?token=${token}`

    const subject = 'Data Subject Rights Request Verification'
    const body = `
      We received your ${requestType} request under GDPR.

      To verify this request, please click the link below:
      ${verificationUrl}

      This link will expire in 24 hours.

      If you did not make this request, please ignore this email.
    `

    // Send verification email (would use existing email infrastructure)
    const { coordinator } = await import('@/lib/infrastructure')
    await coordinator.send({
      id: `verification_${requestId}`,
      to: email,
      subject,
      body,
      campaignId: 'compliance',
      sequenceId: null,
      sequenceStep: null
    })
  }

  private async getDataSubjectRequest(requestId: string): Promise<DataSubjectRequest | null> {
    const result = await query('SELECT * FROM data_subject_requests WHERE id = $1', [requestId])
    if (result.rows.length === 0) return null

    const row = result.rows[0]
    return {
      id: row.id,
      contactId: row.contact_id,
      requestType: row.request_type,
      status: row.status,
      requestedAt: row.requested_at,
      completedAt: row.completed_at,
      response: row.response,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      verificationToken: row.verification_token
    }
  }

  private async storeViolation(violation: ComplianceViolation): Promise<void> {
    await query(`
      INSERT INTO compliance_violations (
        id, contact_id, campaign_id, violation_type, severity,
        description, detected_at, resolved
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      violation.id,
      violation.contactId,
      violation.campaignId || null,
      violation.violationType,
      violation.severity,
      violation.description,
      violation.detectedAt,
      violation.resolved
    ])
  }
}

// Singleton instance
export const advancedComplianceEngine = new AdvancedComplianceEngine()

/**
 * Check compliance before sending email
 */
export async function checkComplianceBeforeSend(
  contactEmail: string,
  campaignId: string,
  emailType?: 'marketing' | 'transactional'
): Promise<{
  compliant: boolean
  violations: ComplianceViolation[]
  warnings: string[]
}> {
  return await advancedComplianceEngine.checkComplianceBeforeSend(contactEmail, campaignId, emailType)
}

/**
 * Record consent for contact
 */
export async function recordConsent(
  contactId: string,
  consentType: ConsentRecord['consentType'],
  consented: boolean,
  consentSource: ConsentRecord['consentSource'],
  consentText: string,
  options?: {
    expiryDate?: Date
    ipAddress?: string
    userAgent?: string
  }
): Promise<ConsentRecord> {
  return await advancedComplianceEngine.recordConsent(contactId, consentType, consented, consentSource, consentText, options)
}

/**
 * Handle GDPR data subject request
 */
export async function handleDataSubjectRequest(
  contactEmail: string,
  requestType: DataSubjectRequest['requestType'],
  ipAddress: string,
  userAgent: string
): Promise<DataSubjectRequest> {
  return await advancedComplianceEngine.handleDataSubjectRequest(contactEmail, requestType, ipAddress, userAgent)
}
