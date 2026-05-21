import nodemailer from 'nodemailer'
import { appEnv } from '@/lib/env'
import type { SendMessageRequest, SendMessageResult } from '@/lib/agents/execution/sender-agent'

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null

type Provider = 'smtp' | 'resend' | 'brevo'
type ApiProvider = Exclude<Provider, 'smtp'>

const API_PROVIDERS: ApiProvider[] = ['brevo', 'resend']

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

function emailDomain(email: string): string {
  return parseAddress(email).email.trim().toLowerCase().split('@')[1] || ''
}

function isBrevoBlockedDomain(senderEmail: string): boolean {
  const domain = emailDomain(senderEmail)
  if (!domain) return false
  const raw = process.env.BREVO_BLOCKED_SENDER_DOMAINS ?? 'vishnuvardhanburri.in'
  return raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`))
}

function envBool(name: string, fallback = false): boolean {
  const value = process.env[name]
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function envInt(names: string[], fallback: number, min: number, max: number): number {
  for (const name of names) {
    const parsed = Number(process.env[name])
    if (Number.isFinite(parsed)) {
      return Math.max(min, Math.min(Math.trunc(parsed), max))
    }
  }
  return fallback
}

function providerDailyLimit(provider: ApiProvider): number {
  if (provider === 'brevo') {
    return envInt(['BREVO_DAILY_LIMIT', 'DAILY_BREVO_LIMIT', 'SENDINBLUE_DAILY_LIMIT'], 300, 0, 100_000)
  }
  return envInt(['RESEND_DAILY_LIMIT', 'DAILY_RESEND_LIMIT'], 100, 0, 100_000)
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function secretFromMisplacedProviderEnv(provider: Provider): string {
  const raw = String(process.env.EMAIL_PROVIDER || process.env.SEND_PROVIDER || '').trim()
  if (provider === 'brevo' && /^xsmtpsib-/i.test(raw)) return raw
  if (provider === 'resend' && /^re_/i.test(raw)) return raw
  return ''
}

function providerSecret(provider: ApiProvider, fromEmail: string): string {
  if (provider === 'brevo' && isBrevoBlockedDomain(fromEmail)) return ''

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

function parseProvider(value: string): Provider | 'auto' | null {
  const raw = value.trim().toLowerCase()
  if (raw === 'auto' || raw === 'central' || raw === 'balanced') return 'auto'
  if (raw === 'smtp' || raw === 'resend' || raw === 'brevo') return raw
  if (raw.startsWith('re_')) return 'resend'
  if (raw.startsWith('xsmtpsib-')) return 'brevo'
  return null
}

function configuredApiProviders(fromEmail: string): ApiProvider[] {
  return API_PROVIDERS.filter((provider) => {
    return (
      providerDailyLimit(provider) > 0 &&
      Boolean(providerSecret(provider, fromEmail)) &&
      !(provider === 'brevo' && isBrevoBlockedDomain(fromEmail))
    )
  })
}

function chooseWeightedProvider(input: {
  request: SendMessageRequest
  to: string[]
  providers: ApiProvider[]
}): ApiProvider {
  const weighted = input.providers
    .map((provider) => ({ provider, weight: providerDailyLimit(provider) }))
    .filter((item) => item.weight > 0)

  if (weighted.length === 0) return input.providers[0] ?? 'resend'
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0)
  const day = new Date().toISOString().slice(0, 10)
  const key = [
    day,
    input.request.fromEmail,
    input.to.join(','),
    input.request.subject,
    input.request.idempotencyKey || '',
  ].join('|')
  let bucket = stableHash(key) % Math.max(totalWeight, 1)

  for (const item of weighted) {
    if (bucket < item.weight) return item.provider
    bucket -= item.weight
  }

  return weighted[weighted.length - 1]!.provider
}

function selectedProvider(request: SendMessageRequest, to: string[]): Provider {
  const fromEmail = request.fromEmail
  const slug = domainSlug(parseAddress(fromEmail).email)
  const explicitProvider = parseProvider(
    String(
      process.env[`EMAIL_PROVIDER_${slug}`] ||
        process.env[`SEND_PROVIDER_${slug}`] ||
        process.env.EMAIL_PROVIDER ||
        process.env.SEND_PROVIDER ||
        ''
    )
  )
  const apiProviders = configuredApiProviders(fromEmail)
  const forceExplicitProvider = envBool('FORCE_EMAIL_PROVIDER', false)

  // Central brain: when multiple API providers are configured, distribute one-by-one
  // by their daily capacity targets instead of hard-locking each domain to a provider.
  if (apiProviders.length > 1 && !forceExplicitProvider) {
    return chooseWeightedProvider({ request, to, providers: apiProviders })
  }

  if (explicitProvider && explicitProvider !== 'auto') {
    if (explicitProvider === 'brevo' && isBrevoBlockedDomain(fromEmail)) {
      if (apiProviders.length === 1) return apiProviders[0]!
      if (apiProviders.length > 1) return chooseWeightedProvider({ request, to, providers: apiProviders })
      return 'smtp'
    }
    return explicitProvider
  }
  if (apiProviders.length === 1) return apiProviders[0]!
  if (apiProviders.length > 1) return chooseWeightedProvider({ request, to, providers: apiProviders })
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
  if (!key) return { success: false, provider: 'resend', error: 'Resend provider selected but RESEND_API_KEY is missing' }

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
    return { success: false, provider: 'resend', error: await readProviderError(response) }
  }

  const data = (await response.json().catch(() => ({}))) as { id?: string; messageId?: string }
  return { success: true, provider: 'resend', providerMessageId: data.id || data.messageId }
}

async function sendViaBrevo(input: {
  request: SendMessageRequest
  to: string[]
  cc: string[]
  subject: string
  headers: Record<string, string>
}): Promise<SendMessageResult> {
  const key = providerSecret('brevo', input.request.fromEmail)
  if (!key) return { success: false, provider: 'brevo', error: 'Brevo provider selected but BREVO_API_KEY is missing' }

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
    return { success: false, provider: 'brevo', error: await readProviderError(response) }
  }

  const data = (await response.json().catch(() => ({}))) as { messageId?: string; messageIds?: string[] }
  return { success: true, provider: 'brevo', providerMessageId: data.messageId || data.messageIds?.[0] }
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

    const baseHeaders = {
      ...request.headers,
      ...(isTestMode ? { 'X-Test-Mode': 'true' } : {}),
    }

    const subject = isTestMode ? `[TEST MODE] ${request.subject}` : request.subject
    const to = isTestMode ? testRecipients : splitAddresses(request.toEmail)
    const cc = isTestMode ? [] : splitAddresses(request.cc)
    const provider = selectedProvider(request, to)
    const headers = {
      ...baseHeaders,
      'X-Sovereign-Send-Provider': provider,
      'X-Sovereign-Provider-Mode': provider === 'smtp' ? 'smtp' : 'central-weighted',
    }

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
      provider: 'smtp',
      providerMessageId: result.messageId,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'smtp send failure',
    }
  }
}
