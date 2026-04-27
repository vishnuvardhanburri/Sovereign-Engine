import nodemailer from 'nodemailer'

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

  const info = await transporter.sendMail({
    from: req.from,
    to: req.to,
    subject: req.subject,
    html: req.html,
    text: req.text,
    headers: req.headers,
  })

  return { messageId: info.messageId ?? '' }
}
