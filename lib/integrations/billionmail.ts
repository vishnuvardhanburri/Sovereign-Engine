import nodemailer from 'nodemailer'
import { appEnv } from '@/lib/env'
import type { SendMessageRequest, SendMessageResult } from '@/lib/agents/execution/sender-agent'

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null

function getTransporter() {
  if (transporter) {
    return transporter
  }

  transporter = nodemailer.createTransport({
    host: appEnv.smtpHost(),
    port: appEnv.smtpPort(),
    secure: appEnv.smtpSecure(),
    auth: {
      user: appEnv.smtpUser(),
      pass: appEnv.smtpPass(),
    },
  })

  return transporter
}

function getTestRecipients(): string[] {
  if (!appEnv.smtpTestMode()) {
    return []
  }
  return appEnv.smtpTestRecipients()
}

export async function sendViaSmtp(
  request: SendMessageRequest
): Promise<SendMessageResult> {
  try {
    const transporter = getTransporter()
    const testRecipients = getTestRecipients()
    const isTestMode = appEnv.smtpTestMode()

    if (isTestMode && testRecipients.length === 0) {
      return {
        success: false,
        error: 'SMTP_TEST_MODE enabled but no SMTP_TEST_RECIPIENTS configured',
      }
    }

    const headers = {
      ...request.headers,
      ...(isTestMode ? { 'X-Test-Mode': 'true' } : {}),
    }

    const subject = isTestMode ? `[TEST MODE] ${request.subject}` : request.subject
    const to = isTestMode ? testRecipients : request.toEmail
    const cc = isTestMode ? undefined : request.cc

    const toHeader = Array.isArray(to) ? to.join(', ') : to
    const ccHeader = Array.isArray(cc) ? cc.join(', ') : cc
    const result = (await transporter.sendMail({
      from: request.fromEmail,
      to: toHeader,
      cc: ccHeader,
      subject,
      text: request.text,
      html: request.html,
      headers,
      envelope: {
        from: request.fromEmail,
        to: toHeader,
        cc: ccHeader,
      },
    })) as { messageId?: string; rejected?: string[] }

    if (Array.isArray(result.rejected) && result.rejected.length > 0) {
      return {
        success: false,
        error: `smtp rejected recipients: ${result.rejected.join(', ')}`,
      }
    }

    return {
      success: true,
      providerMessageId: result.messageId,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'smtp send failure',
    }
  }
}
