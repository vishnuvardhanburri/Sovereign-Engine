import { appEnv } from '@/lib/env'
import { sendTelegramMessage } from '@/lib/telegram'

export type TelegramNotificationType =
  | 'email_sent'
  | 'email_failed'
  | 'lead_scout'
  | 'sheet_import'
  | 'maps_import'
  | 'hunter_domain_search'
  | 'contacts_approved'
  | 'queue_batch'
  | 'queue_skipped'
  | 'daily_outbound'
  | 'reputation_recovery'

type TelegramEnv = Record<string, string | undefined>

type TelegramNotification =
  | {
      type: 'email_sent'
      to: string
      from?: string | null
      subject?: string | null
      providerMessageId?: string | null
      campaign?: string | null
    }
  | {
      type: 'email_failed'
      to: string
      from?: string | null
      subject?: string | null
      error?: string | null
      campaign?: string | null
    }
  | {
      type: 'lead_scout'
      imported: number
      scanned: number
      evidenceBacked: number
      blockedUnverified: number
      industry?: string | null
      persona?: string | null
    }
  | {
      type: 'sheet_import'
      imported: number
      prepared: number
      rejected: number
      evidenceBacked: number
      sheetUrl?: string | null
    }
  | {
      type: 'maps_import'
      imported: number
      prepared: number
      rejected: number
      evidenceBacked: number
      datasetId?: string | null
      source?: string | null
    }
  | {
      type: 'hunter_domain_search'
      imported: number
      scanned: number
      rejected: number
      failures?: number | null
    }
  | {
      type: 'contacts_approved'
      approved: number
      mode?: string | null
    }
  | {
      type: 'queue_batch'
      queued: number
      source?: string | null
      queue?: string | null
      limit?: number | null
      estimatedPipelineValueUsd?: number | null
      agencyQueued?: number | null
      directQueued?: number | null
    }
  | {
      type: 'queue_skipped'
      reason: string
      source?: string | null
    }
  | {
      type: 'daily_outbound'
      dryRun?: boolean
      imported?: number
      approved?: number
      queued?: number
      estimatedPipelineValueUsd?: number
      agencyQueued?: number
      directQueued?: number
      sendLimit?: number
      approveLimit?: number
      failures?: number
      targetDailyVolume?: number
      capacityRemaining?: number
      healthyDomains?: number
      eligibleSenderIdentities?: number
      primaryBlocker?: string | null
      nextAction?: string | null
    }
  | {
      type: 'reputation_recovery'
      clientId: number
      paused: number
      domains: string[]
      reason: string
    }

function envBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function clip(value: string | null | undefined, max = 240): string {
  const text = String(value ?? '').trim()
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}...`
}

export function maskEmail(email: string, showFull = false): string {
  const value = String(email || '').trim().toLowerCase()
  if (showFull || !value.includes('@')) return value

  const [name, domain] = value.split('@')
  if (!name || !domain) return value
  if (name.length <= 2) return `${name[0] ?? '*'}*@${domain}`
  return `${name[0]}***${name[name.length - 1]}@${domain}`
}

export function shouldNotifyTelegram(type: TelegramNotificationType, env: TelegramEnv = process.env): boolean {
  if (!envBool(env.TELEGRAM_NOTIFICATIONS_ENABLED, true)) return false

  const eventFlags: Record<TelegramNotificationType, string> = {
    email_sent: 'TELEGRAM_NOTIFY_SENT',
    email_failed: 'TELEGRAM_NOTIFY_FAILED',
    lead_scout: 'TELEGRAM_NOTIFY_IMPORTS',
    sheet_import: 'TELEGRAM_NOTIFY_IMPORTS',
    maps_import: 'TELEGRAM_NOTIFY_IMPORTS',
    hunter_domain_search: 'TELEGRAM_NOTIFY_IMPORTS',
    contacts_approved: 'TELEGRAM_NOTIFY_APPROVALS',
    queue_batch: 'TELEGRAM_NOTIFY_QUEUE',
    queue_skipped: 'TELEGRAM_NOTIFY_QUEUE',
    daily_outbound: 'TELEGRAM_NOTIFY_QUEUE',
    reputation_recovery: 'TELEGRAM_NOTIFY_QUEUE',
  }

  return envBool(env[eventFlags[type]], true)
}

export function formatTelegramNotification(input: TelegramNotification, options?: { showFullEmails?: boolean }): string {
  const fullEmails = Boolean(options?.showFullEmails)

  if (input.type === 'email_sent') {
    return [
      'Sovereign Engine',
      'Email sent',
      `To: ${maskEmail(input.to, fullEmails)}`,
      input.from ? `From: ${maskEmail(input.from, fullEmails)}` : null,
      input.subject ? `Subject: ${clip(input.subject, 120)}` : null,
      input.providerMessageId ? `Provider ID: ${clip(input.providerMessageId, 80)}` : null,
      input.campaign ? `Campaign: ${clip(input.campaign, 80)}` : null,
    ].filter(Boolean).join('\n')
  }

  if (input.type === 'email_failed') {
    return [
      'Sovereign Engine',
      'Email failed or bounced',
      `To: ${maskEmail(input.to, fullEmails)}`,
      input.from ? `From: ${maskEmail(input.from, fullEmails)}` : null,
      input.subject ? `Subject: ${clip(input.subject, 120)}` : null,
      input.error ? `Reason: ${clip(input.error, 200)}` : null,
      input.campaign ? `Campaign: ${clip(input.campaign, 80)}` : null,
    ].filter(Boolean).join('\n')
  }

  if (input.type === 'sheet_import') {
    return [
      'Sovereign Engine',
      'Google Sheet import',
      `Imported: ${input.imported}`,
      `Prepared: ${input.prepared}`,
      `Evidence-backed: ${input.evidenceBacked}`,
      `Filtered: ${input.rejected}`,
      input.sheetUrl ? `Sheet: ${clip(input.sheetUrl, 160)}` : null,
      'Status: review required before sending',
    ].filter(Boolean).join('\n')
  }

  if (input.type === 'maps_import') {
    return [
      'Sovereign Engine',
      'Google Maps lead intake',
      `Imported: ${input.imported}`,
      `Prepared: ${input.prepared}`,
      `Evidence-backed: ${input.evidenceBacked}`,
      `Filtered: ${input.rejected}`,
      input.source ? `Source: ${clip(input.source, 80)}` : null,
      input.datasetId ? `Dataset: ${clip(input.datasetId, 80)}` : null,
      'Status: review + approval gate required before sending',
    ].filter(Boolean).join('\n')
  }

  if (input.type === 'lead_scout') {
    return [
      'Sovereign Engine',
      'Autonomous lead scout',
      `Scanned: ${input.scanned}`,
      `Evidence-backed: ${input.evidenceBacked}`,
      `Imported: ${input.imported}`,
      `Blocked unverified: ${input.blockedUnverified}`,
      input.industry ? `Industry: ${clip(input.industry, 60)}` : null,
      input.persona ? `Persona: ${clip(input.persona, 60)}` : null,
      'Status: exact public evidence required before approval',
    ].filter(Boolean).join('\n')
  }

  if (input.type === 'hunter_domain_search') {
    return [
      'Sovereign Engine',
      'Hunter domain search',
      `Domains searched: ${input.scanned}`,
      `Imported: ${input.imported}`,
      `Filtered: ${input.rejected}`,
      `Provider failures: ${input.failures ?? 0}`,
      'Status: Hunter-sourced contacts still pass approval and reputation gates',
    ].filter(Boolean).join('\n')
  }

  if (input.type === 'contacts_approved') {
    return [
      'Sovereign Engine',
      'Prospects approved',
      `Approved: ${input.approved}`,
      input.mode ? `Mode: ${input.mode}` : null,
      'Next: outbound cron can queue approved contacts safely',
    ].filter(Boolean).join('\n')
  }

  if (input.type === 'queue_batch') {
    return [
      'Sovereign Engine',
      'Outbound queue updated',
      `Queued: ${input.queued}`,
      input.source ? `Source: ${input.source}` : null,
      input.queue ? `Queue: ${input.queue}` : null,
      input.limit ? `Limit: ${input.limit}` : null,
      input.estimatedPipelineValueUsd
        ? `Pipeline value: $${input.estimatedPipelineValueUsd.toLocaleString('en-US')}`
        : null,
      input.agencyQueued || input.directQueued
        ? `Mix: ${input.agencyQueued ?? 0} agency / ${input.directQueued ?? 0} direct`
        : null,
    ].filter(Boolean).join('\n')
  }

  if (input.type === 'daily_outbound') {
    return [
      'Sovereign Engine',
      input.dryRun ? 'Daily autopilot preview' : 'Daily autopilot run',
      `Imported: ${input.imported ?? 0}`,
      `Approved: ${input.approved ?? 0}`,
      `Queued: ${input.queued ?? 0}`,
      input.estimatedPipelineValueUsd
        ? `Pipeline value: $${input.estimatedPipelineValueUsd.toLocaleString('en-US')}`
        : null,
      input.agencyQueued || input.directQueued
        ? `Mix: ${input.agencyQueued ?? 0} agency / ${input.directQueued ?? 0} direct`
        : null,
      input.targetDailyVolume ? `Target/day: ${input.targetDailyVolume}` : null,
      input.capacityRemaining !== undefined ? `Capacity left: ${input.capacityRemaining}` : null,
      input.healthyDomains !== undefined ? `Healthy domains: ${input.healthyDomains}` : null,
      input.eligibleSenderIdentities !== undefined
        ? `Sender identities: ${input.eligibleSenderIdentities}`
        : null,
      input.primaryBlocker ? `Blocker: ${clip(input.primaryBlocker, 140)}` : null,
      input.nextAction ? `Next: ${clip(input.nextAction, 180)}` : null,
      `Approval limit: ${input.approveLimit ?? 0}`,
      `Send limit: ${input.sendLimit ?? 0}`,
      `Stage failures: ${input.failures ?? 0}`,
    ].filter(Boolean).join('\n')
  }

  if (input.type === 'reputation_recovery') {
    return [
      'Sovereign Engine',
      'Reputation recovery activated',
      `Client: ${input.clientId}`,
      `Paused domains: ${input.paused}`,
      input.domains.length ? `Domains: ${clip(input.domains.join(', '), 180)}` : null,
      `Reason: ${clip(input.reason, 160)}`,
      'Status: sending paused until domain health recovers',
    ].filter(Boolean).join('\n')
  }

  return [
    'Sovereign Engine',
    'Outbound queue skipped',
    `Reason: ${clip(input.reason, 160)}`,
    input.source ? `Source: ${input.source}` : null,
  ].filter(Boolean).join('\n')
}

export async function notifyTelegramEvent(input: TelegramNotification) {
  if (!shouldNotifyTelegram(input.type)) {
    return { delivered: false as const, reason: 'event disabled' as const }
  }

  const botToken = appEnv.telegramBotToken()
  const chatId = process.env.TELEGRAM_CHAT_ID || ''
  if (!botToken || !chatId) {
    return { delivered: false as const, reason: 'telegram not configured' as const }
  }

  try {
    return await sendTelegramMessage({
      botToken,
      chatId,
      text: formatTelegramNotification(input, {
        showFullEmails: envBool(process.env.TELEGRAM_FULL_EMAILS, false),
      }),
      parseMode: 'none',
    })
  } catch (error) {
    console.error('[telegram] notification failed', error)
    return { delivered: false as const, reason: 'telegram send failed' as const }
  }
}
