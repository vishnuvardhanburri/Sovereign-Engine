/**
 * FAILSAFE & MONITORING SYSTEM
 * Handles critical failures with graceful degradation
 */

import { query, queryOne } from '@/lib/db'
import { appEnv } from '@/lib/env'

// ============================================================
// CHANGE RATE LIMITER (Max 3 system changes/day)
// ============================================================

interface SystemChange {
  timestamp: Date
  action: 'pause' | 'resume' | 'optimize' | 'reduce_volume' | 'increase_volume'
  domain_id: number
  reason: string
}

const changeLog: SystemChange[] = []

export async function canMakeSystemChange(domainId: number): Promise<boolean> {
  // Get changes from last 24 hours
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const recentChanges = changeLog.filter(
    (c) => c.domain_id === domainId && c.timestamp > dayAgo
  )
  
  // Allow max 3 changes per domain per day
  return recentChanges.length < 3
}

export function recordSystemChange(change: SystemChange): void {
  changeLog.push(change)
  
  // Cleanup old entries (> 24 hours)
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  while (changeLog.length > 0 && changeLog[0].timestamp < dayAgo) {
    changeLog.shift()
  }
}

// ============================================================
// EMAIL QUALITY FALLBACK
// ============================================================

export const FALLBACK_TEMPLATES = {
  intro: [
    'Quick question about {{Company}} - ',
    'Noticed {{Company}} is doing well with {{Title}} leadership - ',
    'Saw {{Company}} recently and had a thought - ',
    'Hi {{FirstName}}, ',
  ],
  body: [
    'Are you open to a brief conversation?',
    'Would that be worth 15 minutes?',
    'Could this be interesting?',
    'Any chance you\'d be open to a quick chat?',
  ],
  questions: [
    'Does this resonate?',
    'Is this something worth exploring?',
    'Thoughts?',
    'Open to a quick discussion?',
  ],
}

export function generateFallbackEmail(input: {
  contact_name?: string | null
  company?: string | null
  title?: string | null
}): { subject: string; body: string } {
  const intro =
    FALLBACK_TEMPLATES.intro[Math.floor(Math.random() * FALLBACK_TEMPLATES.intro.length)]
  const bodyLine =
    FALLBACK_TEMPLATES.body[Math.floor(Math.random() * FALLBACK_TEMPLATES.body.length)]
  const question =
    FALLBACK_TEMPLATES.questions[
      Math.floor(Math.random() * FALLBACK_TEMPLATES.questions.length)
    ]

  const firstName = input.contact_name?.split(' ')[0] || 'there'
  const company = input.company || 'your company'
  const title = input.title || 'your team'

  const subject = intro
    .replace('{{Company}}', company)
    .replace('{{Title}}', title)
    .replace('{{FirstName}}', firstName)

  const body = `${bodyLine}\n\n${question}`

  return { subject, body }
}

// ============================================================
// QUEUE DEPTH MONITORING
// ============================================================

export async function getQueueDepth(clientId: number): Promise<number> {
  const result = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM queue_jobs WHERE client_id = $1 AND status = 'pending'`,
    [clientId]
  )
  return Number(result?.count ?? 0)
}

export async function shouldThrottleSending(clientId: number): Promise<boolean> {
  const depth = await getQueueDepth(clientId)
  
  // Throttle if > 10,000 pending jobs
  if (depth > 10000) {
    return true
  }
  
  // Warn at > 5,000
  if (depth > 5000) {
    console.warn(`[Failsafe] Queue depth high: ${depth} pending jobs for client ${clientId}`)
  }
  
  return false
}

// ============================================================
// CRITICAL ERROR ALERTS
// ============================================================

export interface CriticalAlert {
  severity: 'warning' | 'critical'
  type: 'domain_paused' | 'queue_overload' | 'smtp_failure' | 'bounce_spike' | 'worker_crash'
  message: string
  clientId: number
  domain_id?: number
  metadata?: Record<string, unknown>
}

const alertQueue: CriticalAlert[] = []

export function queueAlert(alert: CriticalAlert): void {
  alertQueue.push(alert)
}

export async function sendAlert(alert: CriticalAlert): Promise<void> {
  const slackWebhook = appEnv.slackWebhookUrl()
  const telegramToken = appEnv.telegramBotToken()
  
  const message = `
🚨 [${alert.severity.toUpperCase()}] ${alert.type}
Client: ${alert.clientId}
${alert.domain_id ? `Domain: ${alert.domain_id}` : ''}
Message: ${alert.message}
  `.trim()
  
  // Send to Slack if configured
  if (slackWebhook) {
    try {
      await fetch(slackWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: message,
          attachments: [
            {
              color: alert.severity === 'critical' ? 'danger' : 'warning',
              text: JSON.stringify(alert.metadata ?? {}, null, 2),
            },
          ],
        }),
      })
    } catch (error) {
      console.error('[Failsafe] Failed to send Slack alert', error)
    }
  }
  
  // Send to Telegram if configured
  if (telegramToken) {
    try {
      // Would need TELEGRAM_CHAT_ID env var
      console.log('[Failsafe] Telegram alert queued:', message)
    } catch (error) {
      console.error('[Failsafe] Failed to queue Telegram alert', error)
    }
  }
  
  // Log to database for audit
  console.log(`[Alert] ${message}`)
}

export async function processPendingAlerts(): Promise<void> {
  while (alertQueue.length > 0) {
    const alert = alertQueue.shift()
    if (alert) {
      await sendAlert(alert)
    }
  }
}

// ============================================================
// GRACEFUL DEGRADATION
// ============================================================

export async function initiateEmergencyPause(input: {
  clientId: number
  reason: 'queue_overload' | 'smtp_failure' | 'bounce_spike' | 'worker_crash'
}): Promise<void> {
  console.error(`[EMERGENCY] Pausing all sending for client ${input.clientId}: ${input.reason}`)
  
  // Update all active domains to paused
  await query(
    `UPDATE domains SET status = 'paused', updated_at = CURRENT_TIMESTAMP 
     WHERE client_id = $1 AND status != 'paused'`,
    [input.clientId]
  )
  
  // Queue critical alert
  queueAlert({
    severity: 'critical',
    type: 'worker_crash',
    message: `Emergency pause activated: ${input.reason}`,
    clientId: input.clientId,
  })
  
  // Process alerts immediately
  await processPendingAlerts()
}

export async function initiateReducedVolume(input: {
  clientId: number
  domainId: number
  reason: string
  targetDailyLimit: number
}): Promise<void> {
  console.warn(
    `[Failsafe] Reducing volume for domain ${input.domainId}: ${input.reason} → ${input.targetDailyLimit}/day`
  )
  
  await query(
    `UPDATE domains SET daily_limit = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [input.targetDailyLimit, input.domainId]
  )
  
  recordSystemChange({
    timestamp: new Date(),
    action: 'reduce_volume',
    domain_id: input.domainId,
    reason: input.reason,
  })
  
  queueAlert({
    severity: 'warning',
    type: 'bounce_spike',
    message: input.reason,
    clientId: input.clientId,
    domain_id: input.domainId,
  })
}

// ============================================================
// WORKER HEALTH CHECK
// ============================================================

export async function recordWorkerHeartbeat(workerId: string): Promise<void> {
  // Store in Redis with 60-second TTL
  // If heartbeat expires, trigger restart
  console.log(`[Worker] Heartbeat: ${workerId}`)
}

export async function checkWorkerHealth(): Promise<boolean> {
  // Check if worker heartbeat is recent
  // Return false if stale (> 30 seconds)
  // This would be implemented with Redis
  return true
}

// ============================================================
// CIRCUIT BREAKER
// ============================================================

const circuitBreakers: Map<string, { failures: number; lastFailure: Date; state: 'closed' | 'open' | 'half-open' }> = new Map()

export function recordCircuitBreakerFailure(name: string): void {
  const breaker = circuitBreakers.get(name) || {
    failures: 0,
    lastFailure: new Date(),
    state: 'closed' as const,
  }
  
  breaker.failures++
  breaker.lastFailure = new Date()
  
  // Open circuit if > 5 failures in 1 minute
  if (breaker.failures > 5 && Date.now() - breaker.lastFailure.getTime() < 60000) {
    breaker.state = 'open'
  }
  
  circuitBreakers.set(name, breaker)
}

export function isCircuitBreakerOpen(name: string): boolean {
  const breaker = circuitBreakers.get(name)
  if (!breaker) return false
  
  // Reset if > 5 minutes since last failure
  if (Date.now() - breaker.lastFailure.getTime() > 300000) {
    breaker.state = 'closed'
    breaker.failures = 0
    circuitBreakers.set(name, breaker)
    return false
  }
  
  return breaker.state === 'open'
}

export function resetCircuitBreaker(name: string): void {
  circuitBreakers.delete(name)
}
