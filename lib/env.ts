const required = (name: string): string => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

const optionalInt = (name: string, fallback: number): number => {
  const value = process.env[name]
  if (!value) {
    return fallback
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

export const appEnv = {
  databaseUrl: () => required('DATABASE_URL'),
  redisUrl: () => required('REDIS_URL'),
  resendApiKey: () => required('RESEND_API_KEY'),
  appBaseUrl: () => required('APP_BASE_URL'),
  unsubscribeSecret: () => process.env.UNSUBSCRIBE_SECRET || process.env.CRON_SECRET || 'xavira-orbit',
  resendWebhookSecret: () => process.env.RESEND_WEBHOOK_SECRET || '',
  telegramBotToken: () => process.env.TELEGRAM_BOT_TOKEN || '',
  openRouterApiKey: () => process.env.OPENROUTER_API_KEY || '',
  openRouterModel: () => process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
  zeroBounceApiKey: () => process.env.ZEROBOUNCE_API_KEY || '',
  clearbitApiKey: () => process.env.CLEARBIT_API_KEY || '',
  apolloApiKey: () => process.env.APOLLO_API_KEY || '',
  hubspotAccessToken: () => process.env.HUBSPOT_ACCESS_TOKEN || '',
  slackWebhookUrl: () => process.env.SLACK_WEBHOOK_URL || '',
  smtpHost: () => required('SMTP_HOST'),
  smtpPort: () => optionalInt('SMTP_PORT', 587),
  smtpSecure: () => process.env.SMTP_SECURE === 'true',
  smtpUser: () => required('SMTP_USER'),
  smtpPass: () => required('SMTP_PASS'),
  imapHost: () => process.env.IMAP_HOST || process.env.SMTP_HOST || '',
  imapPort: () => optionalInt('IMAP_PORT', 993),
  imapSecure: () => process.env.IMAP_SECURE !== 'false',
  imapUser: () => process.env.IMAP_USER || process.env.SMTP_USER || '',
  imapPass: () => process.env.IMAP_PASS || process.env.SMTP_PASS || '',
  imapMailbox: () => process.env.IMAP_MAILBOX || 'INBOX',
  smtpFromEmail: () => process.env.SMTP_FROM_EMAIL || `no-reply@${process.env.SMTP_HOST?.split(':')[0] ?? 'xaviraorbit.com'}`,
  smtpTestMode: () => process.env.SMTP_TEST_MODE === 'true',
  smtpTestRecipients: () => {
    const raw = process.env.SMTP_TEST_RECIPIENTS || process.env.SMTP_TEST_RECIPIENT_EMAILS || ''
    return raw
      .split(/[\s,]+/)
      .map((candidate) => candidate.trim())
      .filter(Boolean)
  },
  defaultClientId: () => optionalInt('DEFAULT_CLIENT_ID', 1),
  minSendDelaySeconds: () => optionalInt('MIN_SEND_DELAY_SECONDS', 60),
  maxSendDelaySeconds: () => optionalInt('MAX_SEND_DELAY_SECONDS', 120),
  workerPollIntervalMs: () => optionalInt('WORKER_POLL_INTERVAL_MS', 1500),
  workerIdleSleepMs: () => optionalInt('WORKER_IDLE_SLEEP_MS', 2000),
  queuePromoteBatchSize: () => optionalInt('QUEUE_PROMOTE_BATCH_SIZE', 100),
  cronSecret: () => required('CRON_SECRET'),
  authSecret: () => process.env.AUTH_SECRET || process.env.CRON_SECRET || 'xavira-orbit-auth',
  // AI Integration
  aiMaxTokensPerRequest: () => optionalInt('AI_MAX_TOKENS_PER_REQUEST', 2000),
  aiDailyCostLimit: () => optionalInt('AI_DAILY_COST_LIMIT', 50), // $50 default
  aiModelPreferences: () => {
    const prefs = process.env.AI_MODEL_PREFERENCES || 'spam_detection:meta-llama/llama-3.1-8b-instruct,reply_analysis:anthropic/claude-3-haiku,personalization:anthropic/claude-3-sonnet'
    const result: Record<string, string[]> = {}
    for (const pref of prefs.split(',')) {
      const [task, models] = pref.split(':')
      if (task && models) {
        result[task.trim()] = models.split('|').map(m => m.trim())
      }
    }
    return result
  },
  // Scraping
  scrapingEnabled: () => process.env.SCRAPING_ENABLED !== 'false',
  scrapingRateLimitMs: () => optionalInt('SCRAPING_RATE_LIMIT_MS', 2000),
  scrapingTimeoutMs: () => optionalInt('SCRAPING_TIMEOUT_MS', 30000),
  scrapingMaxConcurrency: () => optionalInt('SCRAPING_MAX_CONCURRENCY', 3),
}

export function validateApiEnv(): void {
  appEnv.databaseUrl()
  appEnv.redisUrl()
  appEnv.appBaseUrl()
}

export function validateWorkerEnv(): void {
  validateApiEnv()
  appEnv.smtpHost()
  appEnv.smtpUser()
  appEnv.smtpPass()
  appEnv.smtpPort()
  appEnv.smtpFromEmail()

  if (appEnv.smtpTestMode() && appEnv.smtpTestRecipients().length === 0) {
    throw new Error(
      'SMTP_TEST_MODE is enabled but SMTP_TEST_RECIPIENTS is missing or empty'
    )
  }
}
