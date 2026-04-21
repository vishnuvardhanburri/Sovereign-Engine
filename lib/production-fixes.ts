// PRODUCTION READINESS FIXES - BACKEND
// Critical backend fixes for 50K+ emails/day

import { query, transaction } from '@/lib/db'
import crypto from 'crypto'
import type { Contact, Domain, Identity, QueueJob, SequenceStep } from '@/lib/db/types'

// 1. IDEMPOTENCY KEY GENERATION
type IdempotencyJob = Pick<QueueJob, 'client_id' | 'contact_id' | 'campaign_id' | 'sequence_step' | 'scheduled_at'>

export function generateIdempotencyKey(job: IdempotencyJob): string {
  const payload = `${job.client_id}:${job.contact_id}:${job.campaign_id}:${job.sequence_step}:${job.scheduled_at}`
  return crypto.createHash('sha256').update(payload).digest('hex').substring(0, 32)
}

// 2. CIRCUIT BREAKER LOGIC
export class CircuitBreaker {
  private failures: Map<string, number> = new Map()
  private lastFailure: Map<string, Date> = new Map()
  private readonly failureThreshold = 5
  private readonly recoveryTimeout = 5 * 60 * 1000 // 5 minutes

  async checkCircuit(entityId: string, entityType: 'identity' | 'domain'): Promise<boolean> {
    const table = entityType === 'identity' ? 'identities' : 'domains'
    const result = await query(`SELECT consecutive_failures, circuit_breaker_until FROM ${table} WHERE id = $1`, [entityId])
    const row = result.rows[0] as { circuit_breaker_until: string | null } | undefined
    
    if (!row) return false
    
    if (row.circuit_breaker_until && new Date(row.circuit_breaker_until) > new Date()) {
      return false // Circuit is open
    }
    
    return true // Circuit is closed
  }

  async recordFailure(entityId: string, entityType: 'identity' | 'domain'): Promise<void> {
    const table = entityType === 'identity' ? 'identities' : 'domains'
    const failures = (this.failures.get(entityId) || 0) + 1
    this.failures.set(entityId, failures)
    this.lastFailure.set(entityId, new Date())
    
    if (failures >= this.failureThreshold) {
      const breakerUntil = new Date(Date.now() + this.recoveryTimeout)
      await query(
        `UPDATE ${table} SET consecutive_failures = $1, circuit_breaker_until = $2 WHERE id = $3`,
        [failures, breakerUntil.toISOString(), entityId]
      )
    } else {
      await query(`UPDATE ${table} SET consecutive_failures = $1 WHERE id = $2`, [failures, entityId])
    }
  }

  async recordSuccess(entityId: string, entityType: 'identity' | 'domain'): Promise<void> {
    this.failures.delete(entityId)
    this.lastFailure.delete(entityId)
    
    const table = entityType === 'identity' ? 'identities' : 'domains'
    await query(`UPDATE ${table} SET consecutive_failures = 0, circuit_breaker_until = NULL WHERE id = $1`, [entityId])
  }
}

export const circuitBreaker = new CircuitBreaker()

// 3. EXPONENTIAL BACKOFF
export function calculateBackoffDelay(attempt: number): number {
  const baseDelay = 60 // 1 minute
  const maxDelay = 24 * 60 * 60 // 24 hours
  const delay = baseDelay * Math.pow(2, attempt - 1)
  return Math.min(delay, maxDelay)
}

// 4. EMAIL VALIDATION PIPELINE
export async function validateEmailPreSend(email: string, clientId: number): Promise<{valid: boolean, score: number, reason?: string}> {
  // Check if already validated recently
  const result = await query<{ email_validation_score: number | null }>(
    `SELECT email_validation_score FROM contacts WHERE client_id = $1 AND email = $2 AND email_validated_at > NOW() - INTERVAL '24 hours'`,
    [clientId, email]
  )

  const cachedValidation = result.rows[0]
  if (cachedValidation?.email_validation_score) {
    return { valid: cachedValidation.email_validation_score > 0.7, score: cachedValidation.email_validation_score }
  }
  
  // Perform validation (simplified - integrate with ZeroBounce/Reacher)
  const isValidFormat = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  if (!isValidFormat) {
    return { valid: false, score: 0, reason: 'invalid_format' }
  }
  
  // Check suppression list
  const suppressed = await query(`SELECT 1 FROM suppression_list WHERE client_id = $1 AND email = $2`, [clientId, email])
  if (suppressed.rows.length > 0) {
    return { valid: false, score: 0, reason: 'suppressed' }
  }
  
  const score = 0.8 // Placeholder - integrate with real validation service
  await query(
    `UPDATE contacts SET email_validation_score = $1, email_validated_at = CURRENT_TIMESTAMP WHERE client_id = $2 AND email = $3`,
    [score, clientId, email]
  )
  
  return { valid: score > 0.7, score }
}

// 5. SEQUENCE STOP-ON-REPLY LOGIC
export async function shouldStopSequence(clientId: number, contactId: number, campaignId: number): Promise<boolean> {
  const result = await query(
    `SELECT 1 FROM events WHERE client_id = $1 AND contact_id = $2 AND campaign_id = $3 AND event_type = 'reply' LIMIT 1`,
    [clientId, contactId, campaignId]
  )
  
  if (result.rows.length > 0) {
    // Mark remaining jobs as stopped
    await query(
      `UPDATE queue_jobs SET sequence_stopped = TRUE WHERE client_id = $1 AND contact_id = $2 AND campaign_id = $3 AND status IN ('pending', 'retry')`,
      [clientId, contactId, campaignId]
    )
    return true
  }
  
  return false
}

// 6. A/B ASSIGNMENT CONSISTENCY
export async function assignABVariant(clientId: number, contactId: number, campaignId: number): Promise<string> {
  // Check if already assigned
  const existing = await query<{ ab_variant: string }>(
    `SELECT ab_variant FROM queue_jobs WHERE client_id = $1 AND contact_id = $2 AND campaign_id = $3 AND ab_variant IS NOT NULL LIMIT 1`,
    [clientId, contactId, campaignId]
  )
  
  if (existing.rows[0]?.ab_variant) {
    return existing.rows[0].ab_variant
  }
  
  // Assign new variant
  const variant = Math.random() < 0.5 ? 'A' : 'B'
  const assignmentId = crypto.randomUUID()
  
  await query(
    `UPDATE queue_jobs SET ab_variant = $1, ab_assignment_id = $2 WHERE client_id = $3 AND contact_id = $4 AND campaign_id = $5`,
    [variant, assignmentId, clientId, contactId, campaignId]
  )
  
  return variant
}

// 7. THREAD STORAGE
export async function linkToThread(clientId: number, contactId: number, campaignId: number, messageId: string, subject: string): Promise<string> {
  const threadId = `thread_${crypto.randomUUID()}`
  
  await query(`
    INSERT INTO email_threads (client_id, contact_id, campaign_id, thread_id, subject)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (client_id, thread_id) DO UPDATE SET
      message_count = email_threads.message_count + 1,
      last_message_at = CURRENT_TIMESTAMP
  `, [clientId, contactId, campaignId, threadId, subject])
  
  return threadId
}

// 8. STRUCTURED LOGGING WITH CORRELATION
export class StructuredLogger {
  private correlationId: string
  
  constructor(correlationId?: string) {
    this.correlationId = correlationId || crypto.randomUUID()
  }
  
  log(level: 'info' | 'warn' | 'error', message: string, metadata?: Record<string, unknown>) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      correlationId: this.correlationId,
      message,
      ...metadata
    }
    
    console.log(JSON.stringify(logEntry))
  }
}

// 9. DOMAIN WARMUP LOGIC
export async function calculateWarmupLimit(domainId: number): Promise<number> {
  const result = await query<{ daily_limit: number; warmup_ramp_percent?: number; warmup_last_increased_at?: string | null }>(
    `SELECT daily_limit, warmup_ramp_percent, warmup_last_increased_at FROM domains WHERE id = $1`,
    [domainId]
  )
  
  const domain = result.rows[0]
  if (!domain) return 0
  
  const baseLimit = domain.daily_limit
  const rampPercent = domain.warmup_ramp_percent || 100
  
  // Gradually increase over time
  if (rampPercent < 100) {
    const lastIncrease = domain.warmup_last_increased_at
    if (!lastIncrease || new Date(lastIncrease).getTime() < Date.now() - 24 * 60 * 60 * 1000) {
      // Increase by 10% every day
      const newRamp = Math.min(rampPercent + 10, 100)
      await query(
        `UPDATE domains SET warmup_ramp_percent = $1, warmup_last_increased_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [newRamp, domainId]
      )
      return Math.floor(baseLimit * newRamp / 100)
    }
  }
  
  return Math.floor(baseLimit * rampPercent / 100)
}

// 10. HEALTH-BASED ROUTING
export interface IdentitySelection {
  identity: Identity & { reputation_score: number; domain_reputation?: number | null }
  domain: Domain
}

export async function selectHealthiestIdentity(clientId: number): Promise<IdentitySelection | null> {
  const result = await query(`
    SELECT i.*, d.reputation_score as domain_reputation
    FROM identities i
    JOIN domains d ON d.id = i.domain_id
    WHERE i.client_id = $1 
      AND i.status = 'active' 
      AND d.status = 'active'
      AND (i.circuit_breaker_until IS NULL OR i.circuit_breaker_until < CURRENT_TIMESTAMP)
      AND (d.circuit_breaker_until IS NULL OR d.circuit_breaker_until < CURRENT_TIMESTAMP)
    ORDER BY 
      (i.reputation_score + d.reputation_score) DESC,
      i.sent_today ASC
    LIMIT 1
  `, [clientId])
  
  const row = result.rows[0] as IdentitySelection['identity'] | undefined
  if (!row) return null
  return { identity: row, domain: row as unknown as Domain }
}

// 11. AI OUTPUT VALIDATION
type AIMessageLike = {
  subject?: string
  html?: string
  text?: string
  unsubscribeUrl?: string
}

export function validateAIMessage(message: AIMessageLike): {valid: boolean, reason?: string} {
  if (!message) {
    return { valid: false, reason: 'invalid_structure' }
  }
  
  if (!message.subject || typeof message.subject !== 'string' || message.subject.length > 200) {
    return { valid: false, reason: 'invalid_subject' }
  }
  
  if (!message.html || typeof message.html !== 'string' || message.html.length > 10000) {
    return { valid: false, reason: 'invalid_html' }
  }
  
  if (!message.unsubscribeUrl || typeof message.unsubscribeUrl !== 'string') {
    return { valid: false, reason: 'missing_unsubscribe' }
  }
  
  return { valid: true }
}

// 12. AI FALLBACK TEMPLATES
type FallbackContact = Pick<Contact, 'name' | 'company' | 'email'>
type FallbackSequenceStep = Pick<SequenceStep, 'subject' | 'body'>

export function getFallbackMessage(contact: FallbackContact, sequenceStep: FallbackSequenceStep): {
  subject: string
  html: string
  text: string
  unsubscribeUrl: string
  spamFlags: string[]
  pattern_ids: string[]
} {
  return {
    subject: sequenceStep.subject.replace('{name}', contact.name || 'there'),
    html: sequenceStep.body.replace('{name}', contact.name || 'there'),
    text: sequenceStep.body.replace('{name}', contact.name || 'there'),
    unsubscribeUrl: 'https://example.com/unsubscribe', // Would be generated
    spamFlags: [],
    pattern_ids: [],
  }
}

// 13. METRICS COLLECTION
export async function recordMetric(clientId: number, name: string, value: number, metadata?: Record<string, unknown>) {
  await query(
    `INSERT INTO system_metrics (client_id, metric_name, metric_value, metadata) VALUES ($1, $2, $3, $4)`,
    [clientId, name, value, metadata || {}]
  )
}

// 14. ALERT SYSTEM
export async function createAlert(clientId: number, type: string, severity: 'low' | 'medium' | 'high' | 'critical', message: string) {
  await query(
    `INSERT INTO alerts (client_id, alert_type, severity, message) VALUES ($1, $2, $3, $4)`,
    [clientId, type, severity, message]
  )
}

// 15. DEAD LETTER QUEUE
export async function moveToDeadLetter(jobId: number, reason: string) {
  await query(
    `UPDATE queue_jobs SET status = 'dead_letter', dead_letter_reason = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [reason, jobId]
  )
}
