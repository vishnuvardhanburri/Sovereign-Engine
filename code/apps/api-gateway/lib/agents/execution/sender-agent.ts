import { sendViaSmtp } from '@/lib/integrations/billionmail'
import { generateIdempotencyKey, circuitBreaker, recordMetric, StructuredLogger, linkToThread } from '@/lib/production-fixes'

export interface SendMessageRequest {
  fromEmail: string
  toEmail: string
  cc?: string | string[]
  subject: string
  html: string
  text: string
  headers: Record<string, string>
  idempotencyKey?: string
  correlationId?: string
  campaignId?: number
  contactId?: number
  clientId?: number
  sequenceStep?: number
  scheduledAt?: string
}

export interface SendMessageResult {
  success: boolean
  providerMessageId?: string
  error?: string
  circuitBreakerOpen?: boolean
}

export async function sendMessage(request: SendMessageRequest): Promise<SendMessageResult> {
  const correlationId = request.correlationId || generateIdempotencyKey({
    client_id: request.clientId ?? request.campaignId ?? 0,
    contact_id: request.contactId ?? 0,
    campaign_id: request.campaignId ?? 0,
    sequence_step: request.sequenceStep ?? 0,
    scheduled_at: request.scheduledAt ?? new Date().toISOString(),
  })
  const logger = new StructuredLogger(correlationId)
  
  logger.log('info', 'Send message attempt', {
    to: request.toEmail,
    subject: request.subject.substring(0, 50),
    campaign_id: request.campaignId
  })
  
  try {
    const result = await sendViaSmtp(request)
    
    if (result.success) {
      await recordMetric(request.campaignId || 0, 'email_sent_success', 1)
      logger.log('info', 'Send successful', { message_id: result.providerMessageId })
      return result
    } else {
      await recordMetric(request.campaignId || 0, 'email_send_failed', 1)
      logger.log('error', 'Send failed', { error: result.error })
      return result
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'unknown error'
    logger.log('error', 'Send exception', { error: errorMsg })
    await recordMetric(request.campaignId || 0, 'email_send_error', 1)
    return { success: false, error: errorMsg }
  }
}
