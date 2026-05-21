import nodemailer from 'nodemailer'
import { appEnv } from '@/lib/env'
import type { SendMessageRequest, SendMessageResult } from '@/lib/agents/execution/sender-agent'

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null

type Provider = 'smtp' | 'resend' | 'brevo'

function splitAddresses(value: string | string[] | undefined): string[] {
  const values = Array.isArray(value) ? value : [value]
  return values
    .flatMap((item) => String(item || '').split(','))
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseAddress(value: string): { email: string; name?: string } {
  const match = value.match(/^(.*?)\s*<([^>]+)>$/)
  if (!match) return { email: value.trim() }
  const name = match[1]?.replace(/^"|"$/g, '').trim()
  return {
    email: match[2]?.trim() || value.trim(),
    ...(name ? { name } : {}),
  }
}

function domainSlug(email: string): string {
  const domain = email.split('@')[1] || ''
  return domain.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function secretFromMisplacedProviderEnv(provider: Provider): string {
  const raw = String(process.env.EMAIL_PROVIDER || process.env.SEND_PROVIDER || '').trim()
  if (provider === 'brevo' && /^xsmtpsib-/i.test(raw)) return raw
  if (provider === 'resend' && /^re_/i.test(raw)) return raw
  return ''
}

function providerSecret(provider: Exclude<Provider, 'smtp'>, fromEmail: string): string {
  const slug = domainSlug(parseAddress(fromEmail).email)
  const domainAliases =
    provider === 'brevo'
      ? [`BREVO_API_KEY_${slug}`, `BREVO_KEY_${slug}`, `SENDINBLUE_API_KEY_${slug}`]
      : [`RESEND_API_KEY_${slug}`, `RESEND_KEY_${slug}`]
  const globalAliases =
    provider === 'brevo'
      ? ['BREVO_API_KEY', 'BREVO_KEY', 'SENDINBLUE_API_KEY', 'SENDINBLUE_KEY', 'brevo_api_key', 'brevo']
      : ['RESEND_API_KEY', 'RESEND_KEY', 'resend_api_key', 'resend']

  for (const alias of [...domainAliases, ...globalAliases]) {
    const value = process.env[alias]
    if (value && value.trim()) return value.trim()
  }

  return secretFromMisplacedProviderEnv(provider)
}

function selectedProvider(fromEmail: string): Provider {
  const raw = String(process.env.EMAIL_PROVIDER || process.env.SEND_PROVIDER || '').trim().toLowerCase()
  if (raw === 'smtp' || raw === 'resend' || raw === 'brevo') return raw
  if (raw.startsWith('re_')) return 'resend'
  if (raw.startsWith('xsmtpsib-')) return 'brevo'
  if (providerSecret('brevo', fromEmail)) return 'brevo'
  if (providerSecret('resend', fromEmail)) return 'resend'
  return 'smtp'
}

async function readProviderError(response: Response): Promise<string> {
  const text = await response.text()
  if (!text) return `${response.status} ${response.statusText}`
  return `${response.status} ${response.statusText}: ${text.slice(0, 500)}`
}

async function sendViaResend(input: {
  request: SendMessageRequest
  to: string[]
  cc: string[]
  subject: string
  headers: Record<string, string>
}): Promise<SendMessageResult> {
  const key = providerSecret('resend', input.request.fromEmail)
  if (!key) return { success: false, error: 'Resend provider selected but RESEND_API_KEY is missing' }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: input.request.fromEmail,
      to: input.to,
      ...(input.cc.length ? { cc: input.cc } : {}),
      subject: input.subject,
      text: input.request.text,
      html: input.request.html,
      headers: input.headers,
    }),
  })

  if (!response.ok) {
    return { success: false, error: await readProviderError(response) }
  }

  const data = (await response.json().catch(() => ({}))) as { id?: string; messageId?: string }
  return { success: true, providerMessageId: data.id || data.messageId }
}

async function sendViaBrevo(input: {
  request: SendMessageRequest
  to: string[]
  cc: string[]
  subject: string
  headers: Record<string, string>
}): Promise<SendMessageResult> {
  const key = providerSecret('brevo', input.request.fromEmail)
  if (!key) return { success: false, error: 'Brevo provider selected but BREVO_API_KEY is missing' }

  const sender = parseAddress(input.request.fromEmail)
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender,
      to: input.to.map((email) => ({ email })),
      ...(input.cc.length ? { cc: input.cc.map((email) => ({ email })) } : {}),
      subject: input.subject,
      textContent: input.request.text,
      htmlContent: input.request.html,
      headers: input.headers,
    }),
  })

  if (!response.ok) {
    return { success: false, error: await readProviderError(response) }
  }

  const data = (await response.json().catch(() => ({}))) as { messageId?: string; messageIds?: string[] }
  return { success: true, providerMessageId: data.messageId || data.messageIds?.[0] }
}

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
    const to = isTestMode ? testRecipients : splitAddresses(request.toEmail)
    const cc = isTestMode ? [] : splitAddresses(request.cc)

    const provider = selectedProvider(request.fromEmail)
    if (provider === 'resend') {
      return await sendViaResend({ request, to, cc, subject, headers })
    }

    if (provider === 'brevo') {
      return await sendViaBrevo({ request, to, cc, subject, headers })
    }

    const transporter = getTransporter()
    const toHeader = to.join(', ')
    const ccHeader = cc.join(', ')
    const result = (await transporter.sendMail({
      from: request.fromEmail,
      to: toHeader,
      cc: ccHeader || undefined,
      subject,
      text: request.text,
      html: request.html,
      headers,
      envelope: {
        from: request.fromEmail,
        to: toHeader,
        cc: ccHeader || undefined,
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
