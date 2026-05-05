// @ts-nocheck
// PRODUCTION READINESS - OBSERVABILITY
// Metrics, alerts, and monitoring for 50K+ emails/day

import { query } from '@/lib/db'
import { createAlert, recordMetric } from '@/lib/production-fixes'

export class MetricsCollector {
  private clientId: number
  
  constructor(clientId: number) {
    this.clientId = clientId
  }
  
  async collectHourlyMetrics() {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000)
    
    // Send rate (emails/hour)
    const sendResult = await query(`
      SELECT COUNT(*) as count FROM events 
      WHERE client_id = $1 AND event_type = 'sent' AND created_at > $2
    `, [this.clientId, hourAgo])
    const sendRate = parseInt(sendResult.rows[0]?.count || '0', 10)
    await recordMetric(this.clientId, 'send_rate_hourly', sendRate)
    
    // Bounce rate (%)
    const bounceResult = await query(`
      SELECT COUNT(*) as bounces FROM events 
      WHERE client_id = $1 AND event_type = 'bounce' AND created_at > $2
    `, [this.clientId, hourAgo])
    const bounces = parseInt(bounceResult.rows[0]?.bounces || '0', 10)
    const bounceRate = sendRate > 0 ? (bounces / sendRate) * 100 : 0
    await recordMetric(this.clientId, 'bounce_rate_percent', bounceRate)
    
    // Reply rate (%)
    const replyResult = await query(`
      SELECT COUNT(*) as replies FROM events 
      WHERE client_id = $1 AND event_type = 'reply' AND created_at > $2
    `, [this.clientId, hourAgo])
    const replies = parseInt(replyResult.rows[0]?.replies || '0', 10)
    const replyRate = sendRate > 0 ? (replies / sendRate) * 100 : 0
    await recordMetric(this.clientId, 'reply_rate_percent', replyRate)
    
    // Error rate (%)
    const errorResult = await query(`
      SELECT COUNT(*) as errors FROM events 
      WHERE client_id = $1 AND event_type IN ('failed', 'bounce') AND created_at > $2
    `, [this.clientId, hourAgo])
    const errors = parseInt(errorResult.rows[0]?.errors || '0', 10)
    const errorRate = sendRate > 0 ? (errors / sendRate) * 100 : 0
    await recordMetric(this.clientId, 'error_rate_percent', errorRate)
    
    // Check for alerts
    await this.checkAlerts(bounceRate, replyRate, errorRate, sendRate)
  }
  
  private async checkAlerts(bounceRate: number, replyRate: number, errorRate: number, sendRate: number) {
    // Bounce rate spike
    if (bounceRate > 5) {
      await createAlert(this.clientId, 'bounce_rate_spike', 'high', `Bounce rate ${bounceRate.toFixed(2)}% exceeds 5% threshold`)
    }
    
    // Send rate drop
    if (sendRate < 10) { // Less than 10 emails/hour
      await createAlert(this.clientId, 'send_rate_drop', 'medium', `Send rate dropped to ${sendRate} emails/hour`)
    }
    
    // Error rate spike
    if (errorRate > 10) {
      await createAlert(this.clientId, 'error_rate_spike', 'critical', `Error rate ${errorRate.toFixed(2)}% exceeds 10% threshold`)
    }
    
    // Reply rate drop (might indicate deliverability issues)
    if (replyRate < 0.1 && sendRate > 50) {
      await createAlert(this.clientId, 'reply_rate_drop', 'medium', `Reply rate ${replyRate.toFixed(2)}% below 0.1% threshold`)
    }
  }
}

export class StructuredLogger {
  private correlationId: string
  private metadata: Record<string, any>
  
  constructor(correlationId?: string, metadata?: Record<string, any>) {
    this.correlationId = correlationId || crypto.randomUUID()
    this.metadata = metadata || {}
  }
  
  log(level: 'info' | 'warn' | 'error', message: string, extra?: any) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      correlationId: this.correlationId,
      message,
      ...this.metadata,
      ...extra
    }
    
    // In production, send to logging service
    console.log(JSON.stringify(logEntry))
  }
  
  child(metadata: Record<string, any>): StructuredLogger {
    return new StructuredLogger(this.correlationId, { ...this.metadata, ...metadata })
  }
}

// Email lifecycle correlation
export async function logEmailLifecycle(clientId: number, contactId: number, campaignId: number, queueJobId: number, event: string, details?: any) {
  const correlationId = `email_${queueJobId}_${Date.now()}`
  const logger = new StructuredLogger(correlationId, {
    clientId,
    contactId,
    campaignId,
    queueJobId,
    event
  })
  
  logger.log('info', `Email ${event}`, details)
  
  // Store in database for correlation
  await query(`
    INSERT INTO events (client_id, campaign_id, contact_id, queue_job_id, event_type, correlation_id, metadata)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [clientId, campaignId, contactId, queueJobId, event, correlationId, details || {}])
}

// Performance monitoring
export class PerformanceMonitor {
  private timers: Map<string, number> = new Map()
  
  start(operation: string): string {
    const id = `${operation}_${Date.now()}_${Math.random()}`
    this.timers.set(id, Date.now())
    return id
  }
  
  end(id: string, metadata?: any) {
    const start = this.timers.get(id)
    if (!start) return
    
    const duration = Date.now() - start
    this.timers.delete(id)
    
    // Log slow operations
    if (duration > 5000) { // 5 seconds
      console.warn(`Slow operation: ${id.split('_')[0]} took ${duration}ms`, metadata)
    }
    
    return duration
  }
}

export const perfMonitor = new PerformanceMonitor()
