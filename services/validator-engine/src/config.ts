import 'dotenv/config'

const req = (name: string) => {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

const int = (name: string, fallback: number) => {
  const v = process.env[name]
  if (!v) return fallback
  const n = Number.parseInt(v, 10)
  return Number.isNaN(n) ? fallback : n
}

export const validatorEnv = {
  databaseUrl: () => req('DATABASE_URL'),
  redisUrl: () => req('REDIS_URL'),

  apiPort: () => int('VALIDATOR_PORT', 4040),
  concurrency: () => int('VALIDATOR_CONCURRENCY', 50),

  // SMTP probing
  // Hard cap: 5 seconds max (production-scale fail-fast)
  smtpTimeoutMs: () => Math.min(5000, int('VALIDATOR_SMTP_TIMEOUT_MS', 5000)),
  smtpPort: () => int('VALIDATOR_SMTP_PORT', 25),
  // Most MTAs accept any MAIL FROM; use a stable domain you control for best results.
  fromEmail: () => process.env.VALIDATOR_FROM_EMAIL || 'validator@sovereign.local',
  heloName: () => process.env.VALIDATOR_HELO_NAME || 'sovereign.local',

  // Guardrails
  perDomainConcurrency: () => int('VALIDATOR_DOMAIN_CONCURRENCY', 3),
  perDomainRatePerMin: () => int('VALIDATOR_DOMAIN_RATE_PER_MIN', 30),

  // Full pipeline wall-clock budget (ms)
  pipelineTimeoutMs: () => Math.min(8000, int('VALIDATOR_PIPELINE_TIMEOUT_MS', 8000)),

  // Circuit breaker window
  breakerTtlSeconds: () => int('VALIDATOR_BREAKER_TTL_SECONDS', 12 * 60), // 12 minutes default
}
