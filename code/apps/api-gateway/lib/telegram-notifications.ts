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
      provider?: string | null
      campaign?: string | null
    }
  | {
      type: 'email_failed'
      to: string
      from?: string | null
      subject?: string | null
      error?: string | null
      provider?: string | null
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
      // Digest fields from getOutboundTelegramDigest
      sentToday?: number
      sent24h?: number
      failed24h?: number
      bounced24h?: number
      replies24h?: number
      replyRate24h?: number
      sent7d?: number
      replies7d?: number
      replyRate7d?: number
      followUpsDue?: number
      followUpsPending?: number
      followUpsSent24h?: number
      followUpsStopped24h?: number
      queuedNow?: number
      lastEvents?: Array<{
        type: 'sent' | 'failed' | 'bounced'
        email: string
        subject: string
        reason?: string
        ts: string
      }>
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
      '✅ *Email Sent Successfully*',
      '━━━━━━━━━━━━━━━━━━━━━━━',
      `👤 *To:* ${maskEmail(input.to, fullEmails)}`,
      input.from ? `📧 *From:* ${maskEmail(input.from, fullEmails)}` : null,
      input.subject ? `📝 *Subject:* _${clip(input.subject, 120)}_` : null,
      input.provider ? `⚡ *Provider:* ${clip(input.provider, 40)}` : null,
      input.campaign ? `🎯 *Campaign:* ${clip(input.campaign, 80)}` : null,
    ].filter(Boolean).join('\n')
  }

  if (input.type === 'email_failed') {
    return [
      '❌ *Email Delivery Failed*',
      '━━━━━━━━━━━━━━━━━━━━━━━',
      `👤 *To:* ${maskEmail(input.to, fullEmails)}`,
      input.from ? `📧 *From:* ${maskEmail(input.from, fullEmails)}` : null,
      input.subject ? `📝 *Subject:* _${clip(input.subject, 120)}_` : null,
      input.provider ? `⚡ *Provider:* ${clip(input.provider, 40)}` : null,
      input.error ? `⚠️ *Error:* \`${clip(input.error, 200)}\`` : null,
      input.campaign ? `🎯 *Campaign:* ${clip(input.campaign, 80)}` : null,
    ].filter(Boolean).join('\n')
  }

  if (input.type === 'sheet_import') {
    return [
      '📥 *Google Sheet Imported*',
      '━━━━━━━━━━━━━━━━━━━━━━━',
      `👥 *Imported Leads:* *${input.imported}*`,
      `📋 *Prepared:* ${input.prepared}`,
      `🛡️ *Evidence-Backed:* *${input.evidenceBacked}*`,
      `🚫 *Filtered/Rejected:* ${input.rejected}`,
      input.sheetUrl ? `📄 *Sheet URL:* ${clip(input.sheetUrl, 160)}` : null,
      '━━━━━━━━━━━━━━━━━━━━━━━',
      '🚦 *Status:* Manual review required before sends trigger.',
    ].filter(Boolean).join('\n')
  }

  if (input.type === 'maps_import') {
    return [
      '🗺️ *Google Maps Lead Intake*',
      '━━━━━━━━━━━━━━━━━━━━━━━',
      `👥 *Imported Leads:* *${input.imported}*`,
      `📋 *Prepared:* ${input.prepared}`,
      `🛡️ *Evidence-Backed:* *${input.evidenceBacked}*`,
      `🚫 *Filtered/Rejected:* ${input.rejected}`,
      input.source ? `🔌 *Source:* ${clip(input.source, 80)}` : null,
      input.datasetId ? `📦 *Dataset ID:* ${clip(input.datasetId, 80)}` : null,
      '━━━━━━━━━━━━━━━━━━━━━━━',
      '🚦 *Status:* Approvals and validation gate required before sending.',
    ].filter(Boolean).join('\n')
  }

  if (input.type === 'lead_scout') {
    return [
      '🕵️‍♂️ *Autonomous Lead Scout*',
      '━━━━━━━━━━━━━━━━━━━━━━━',
      `🔎 *Scanned Prospects:* ${input.scanned}`,
      `🛡️ *Evidence-Backed:* *${input.evidenceBacked}*`,
      `👥 *Imported:* *${input.imported}*`,
      `🚫 *Blocked Unverified:* ${input.blockedUnverified}`,
      input.industry ? `🏢 *Industry:* ${clip(input.industry, 60)}` : null,
      input.persona ? `🎯 *Persona:* ${clip(input.persona, 60)}` : null,
      '━━━━━━━━━━━━━━━━━━━━━━━',
      '🚦 *Status:* Exact public evidence required before approval.',
    ].filter(Boolean).join('\n')
  }

  if (input.type === 'hunter_domain_search') {
    return [
      '🏹 *Hunter Domain Search*',
      '━━━━━━━━━━━━━━━━━━━━━━━',
      `🌐 *Domains Searched:* ${input.scanned}`,
      `👥 *Imported Leads:* *${input.imported}*`,
      `🚫 *Filtered/Rejected:* ${input.rejected}`,
      `⚠️ *Provider Failures:* ${input.failures ?? 0}`,
      '━━━━━━━━━━━━━━━━━━━━━━━',
      '🚦 *Status:* Hunter-sourced contacts still pass approval and reputation gates.',
    ].filter(Boolean).join('\n')
  }

  if (input.type === 'contacts_approved') {
    return [
      '✅ *Prospects Approved*',
      '━━━━━━━━━━━━━━━━━━━━━━━',
      `👥 *Approved:* *${input.approved}*`,
      input.mode ? `⚙️ *Mode:* ${input.mode}` : null,
      '━━━━━━━━━━━━━━━━━━━━━━━',
      '🚦 *Next:* Outbound cron can queue approved contacts safely.',
    ].filter(Boolean).join('\n')
  }

  if (input.type === 'queue_batch') {
    return [
      '⚡ *Outbound Queue Updated*',
      '━━━━━━━━━━━━━━━━━━━━━━━',
      `📤 *Queued:* *${input.queued}*`,
      input.source ? `🔌 *Source:* ${input.source}` : null,
      input.queue ? `📋 *Queue:* ${input.queue}` : null,
      input.limit ? `🎯 *Limit:* ${input.limit}` : null,
      input.estimatedPipelineValueUsd
        ? `💰 *Pipeline Value:* *$${input.estimatedPipelineValueUsd.toLocaleString('en-US')}*`
        : null,
      input.agencyQueued || input.directQueued
        ? `⚖️ *Mix:* ${input.agencyQueued ?? 0} agency / ${input.directQueued ?? 0} direct`
        : null,
    ].filter(Boolean).join('\n')
  }

  if (input.type === 'daily_outbound') {
    const hasDigest =
      input.sentToday !== undefined ||
      input.sent24h !== undefined ||
      input.queuedNow !== undefined

    if (hasDigest) {
      const sent = input.sentToday ?? 0
      const failed = input.failed24h ?? 0
      const bounced = input.bounced24h ?? 0
      const replies = input.replies24h ?? 0
      const rr = (input.replyRate24h ?? 0).toFixed(1)
      const queued = input.queuedNow ?? input.queued ?? 0
      const agency = input.agencyQueued ?? 0
      const direct = input.directQueued ?? 0
      const pipeline = input.estimatedPipelineValueUsd
      const fu_due = input.followUpsDue ?? 0
      const fu_pending = input.followUpsPending ?? 0
      const fu_sent = input.followUpsSent24h ?? 0
      const fu_stopped = input.followUpsStopped24h ?? 0
      const blocker = input.primaryBlocker
      const topFailure = (input as any).topFailureReason as string | null | undefined
      const nextAction = (input as any).nextAction as string | undefined

      const lastLines = (input.lastEvents ?? []).slice(0, 4).map((ev) => {
        const icon = ev.type === 'sent' ? '✅' : ev.type === 'failed' ? '❌' : '⚠️'
        const reason = ev.reason ? ` (${clip(ev.reason, 55)})` : ''
        return `${icon} ${clip(ev.subject, 55)}${reason}`
      })

      const lines: (string | null)[] = [
        input.dryRun
          ? '🔍 *Sovereign Engine — Dry Run Preview*'
          : '🚀 *Sovereign Engine — Daily Outbound Report*',
        '━━━━━━━━━━━━━━━━━━━━━━━',
        `📤 Sent today: *${sent}*   ❌ Failed: ${failed}   ⚠️ Bounced: ${bounced}`,
        `💬 Replies: *${replies}* (${rr}% reply rate)`,
        `📋 Queued: ${queued}`,
        agency || direct
          ? `🎯 Mix: ${agency} agency ($100k) / ${direct} direct ($25k)`
          : null,
        pipeline
          ? `💰 Pipeline value: *$${pipeline.toLocaleString('en-US')}*`
          : null,
        '━━━━━━━━━━━━━━━━━━━━━━━',
        `🔁 Follow-ups: ${fu_due} due / ${fu_pending} pending / ${fu_sent} sent today / ${fu_stopped} stopped`,
        '━━━━━━━━━━━━━━━━━━━━━━━',
        topFailure ? `❗ Top failure: \`${clip(topFailure, 100)}\`` : null,
        blocker && blocker !== 'ready' ? `🚧 Blocker: ${clip(blocker, 100)}` : null,
        nextAction ? `💡 Next action: ${clip(nextAction, 200)}` : null,
        lastLines.length ? `\nRecent events:\n${lastLines.join('\n')}` : null,
      ]

      return lines.filter(Boolean).join('\n')
    }

    // Fallback — no digest data available yet
    return [
      '🚀 Sovereign Engine',
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
      input.primaryBlocker ? `Blocker: ${clip(input.primaryBlocker, 140)}` : null,
      `Stage failures: ${input.failures ?? 0}`,
    ].filter(Boolean).join('\n')
  }

  if (input.type === 'reputation_recovery') {
    return [
      '🛡️ *Reputation Recovery Alert*',
      '━━━━━━━━━━━━━━━━━━━━━━━',
      `👤 *Client ID:* ${input.clientId}`,
      `⏸️ *Paused Domains:* ${input.paused}`,
      input.domains.length ? `🌐 *Domains:* ${clip(input.domains.join(', '), 180)}` : null,
      `⚠️ *Reason:* _${clip(input.reason, 160)}_`,
      '━━━━━━━━━━━━━━━━━━━━━━━',
      '🛑 *Status:* Sending paused until domain health recovers.',
    ].filter(Boolean).join('\n')
  }

  return [
    '⚠️ *Outbound Queue Skipped*',
    '━━━━━━━━━━━━━━━━━━━━━━━',
    `🔍 *Reason:* _${clip(input.reason, 160)}_`,
    input.source ? `🔌 *Source:* ${input.source}` : null,
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
