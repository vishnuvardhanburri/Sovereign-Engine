import { sendViaSmtp } from '@/lib/integrations/billionmail'

export interface SendMessageRequest {
  fromEmail: string
  toEmail: string
  cc?: string | string[]
  subject: string
  html: string
  text: string
  headers: Record<string, string>
}

export interface SendMessageResult {
  success: boolean
  providerMessageId?: string
  error?: string
}

export async function sendMessage(request: SendMessageRequest): Promise<SendMessageResult> {
  return sendViaSmtp(request)
}
