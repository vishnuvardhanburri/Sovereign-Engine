type TlsCheck = {
  name: string
  required: boolean
  compliant: boolean
  detail: string
}

function boolEnv(name: string, fallback = false) {
  const raw = process.env[name]
  if (raw == null) return fallback
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase())
}

function databaseUsesTls(raw = process.env.DATABASE_URL || '') {
  try {
    const url = new URL(raw)
    const sslmode = url.searchParams.get('sslmode')?.toLowerCase()
    return sslmode === 'require' || sslmode === 'verify-ca' || sslmode === 'verify-full'
  } catch {
    return false
  }
}

function redisUsesTls(raw = process.env.REDIS_URL || '') {
  return raw.trim().toLowerCase().startsWith('rediss://')
}

function appUsesHttps() {
  const explicit = process.env.APP_BASE_URL || ''
  if (explicit) return explicit.toLowerCase().startsWith('https://')
  return (process.env.APP_PROTOCOL || '').toLowerCase() === 'https'
}

function smtpUsesTls() {
  return process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT ?? 0) === 465
}

export function evaluateTlsPolicy(): {
  required: boolean
  compliant: boolean
  checks: TlsCheck[]
  minimumVersion: string
} {
  const required = boolEnv('REQUIRE_INTERNAL_TLS', false)
  const checks: TlsCheck[] = [
    {
      name: 'postgres',
      required,
      compliant: !required || databaseUsesTls(),
      detail: databaseUsesTls() ? 'DATABASE_URL requires TLS' : 'DATABASE_URL does not advertise sslmode=require/verify',
    },
    {
      name: 'redis',
      required,
      compliant: !required || redisUsesTls(),
      detail: redisUsesTls() ? 'REDIS_URL uses rediss://' : 'REDIS_URL does not use rediss://',
    },
    {
      name: 'api_base_url',
      required,
      compliant: !required || appUsesHttps(),
      detail: appUsesHttps() ? 'public app URL is HTTPS' : 'APP_PROTOCOL/APP_BASE_URL is not HTTPS',
    },
    {
      name: 'smtp',
      required,
      compliant: !required || smtpUsesTls(),
      detail: smtpUsesTls() ? 'SMTP transport is configured for TLS' : 'SMTP_SECURE is false and SMTP_PORT is not 465',
    },
  ]

  return {
    required,
    compliant: checks.every((check) => check.compliant),
    checks,
    minimumVersion: process.env.TLS_MIN_VERSION || 'TLSv1.3',
  }
}
