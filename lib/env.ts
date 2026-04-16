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
  defaultClientId: () => optionalInt('DEFAULT_CLIENT_ID', 1),
  minSendDelaySeconds: () => optionalInt('MIN_SEND_DELAY_SECONDS', 60),
  maxSendDelaySeconds: () => optionalInt('MAX_SEND_DELAY_SECONDS', 120),
  workerPollIntervalMs: () => optionalInt('WORKER_POLL_INTERVAL_MS', 1500),
  workerIdleSleepMs: () => optionalInt('WORKER_IDLE_SLEEP_MS', 2000),
  queuePromoteBatchSize: () => optionalInt('QUEUE_PROMOTE_BATCH_SIZE', 100),
  cronSecret: () => required('CRON_SECRET'),
}

export function validateApiEnv(): void {
  appEnv.databaseUrl()
  appEnv.redisUrl()
  appEnv.appBaseUrl()
}

export function validateWorkerEnv(): void {
  validateApiEnv()
  appEnv.resendApiKey()
}
