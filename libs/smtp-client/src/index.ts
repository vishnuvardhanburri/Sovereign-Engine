import nodemailer from 'nodemailer'
import crypto from 'crypto'

export interface SmtpConfig {
  host: string
  port?: number
  secure?: boolean
  user: string
  pass: string
}

export interface SendEmailRequest {
  from: string
  to: string
  subject: string
  html?: string
  text?: string
  headers?: Record<string, string>
  headerContext?: HeaderFactoryContext
}

export interface HeaderFactoryContext {
  clientId?: number
  campaignId?: number | null
  queueJobId?: number | null
  idempotencyKey?: string | null
  sendingDomain?: string | null
  provider?: string | null
  traceId?: string | null
}

export interface BuiltSmtpHeaders {
  messageId: string
  headers: Record<string, string>
}

function cleanHeaderValue(value: unknown): string {
  return String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^\t\x20-\x7e]/g, '')
    .trim()
}

function domainFromEmail(email: string): string {
  const domain = email.split('@')[1]?.trim().toLowerCase()
  return domain && /^[a-z0-9.-]+$/.test(domain) ? domain : 'localhost'
}

function stableHex(parts: Array<unknown>, len = 24): string {
  return crypto.createHash('sha256').update(parts.map((part) => String(part ?? '')).join('|')).digest('hex').slice(0, len)
}

/**
 * Compliance-safe SMTP header factory.
 *
 * This intentionally does not impersonate consumer/webmail clients. The goal is
 * RFC-clean, stable, traceable enterprise mail headers that align with the
 * authenticated sending domain and avoid accidental header leakage.
 */
export function buildCompliantSmtpHeaders(req: SendEmailRequest): BuiltSmtpHeaders {
  const ctx = req.headerContext ?? {}
  const sendingDomain = cleanHeaderValue(ctx.sendingDomain) || domainFromEmail(req.from)
  const traceId = cleanHeaderValue(ctx.traceId) || stableHex([
    ctx.clientId,
    ctx.campaignId,
    ctx.queueJobId,
    ctx.idempotencyKey,
    req.to,
  ], 32)
  const localPart = [
    'xo',
    stableHex([traceId, ctx.idempotencyKey, ctx.provider], 12),
    Date.now().toString(36),
  ].join('.')

  const baseHeaders: Record<string, string> = {
    'X-Mailer': 'Sovereign Engine Enterprise Mailer',
    'X-Entity-Ref-ID': traceId,
    'X-Sovereign Engine-Trace': traceId,
    'X-Sovereign Engine-Provider-Lane': cleanHeaderValue(ctx.provider ?? 'unknown'),
    'MIME-Version': '1.0',
  }

  const userHeaders = Object.fromEntries(
    Object.entries(req.headers ?? {})
      .filter(([key]) => !/^message-id$/i.test(key))
      .map(([key, value]) => [cleanHeaderValue(key), cleanHeaderValue(value)])
      .filter(([key]) => Boolean(key))
  )

  return {
    messageId: `<${localPart}@${sendingDomain}>`,
    headers: {
      ...baseHeaders,
      ...userHeaders,
    },
  }
}

export async function sendSmtp(config: SmtpConfig, req: SendEmailRequest): Promise<{ messageId: string }> {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port ?? (config.secure ? 465 : 587),
    secure: Boolean(config.secure),
    // Prevent hanging workers on slow/bad SMTP connections.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  })

  const built = buildCompliantSmtpHeaders(req)
  const info = await transporter.sendMail({
    from: req.from,
    to: req.to,
    subject: req.subject,
    html: req.html,
    text: req.text,
    messageId: built.messageId,
    headers: built.headers,
  })

  return { messageId: info.messageId ?? '' }
}
