/**
 * TELEGRAM DAILY REPORTING SYSTEM
 * Sends daily performance reports to user via Telegram
 */

import { appEnv } from '@/lib/env'
import { collectSystemMetrics } from '@/lib/services/metrics'
import { query, queryOne } from '@/lib/db'

export interface DailyReport {
  date: string
  clientId: number
  emailsSent: number
  repliesReceived: number
  bounceCount: number
  bounceRate: number
  replyRate: number
  positiveReplyRate: number
  systemActions: string[]
  domainsStatus: {
    active: number
    warming: number
    paused: number
  }
  anomaliesDetected: string[]
}

async function getSystemActions(clientId: number, hoursBack: number = 24): Promise<string[]> {
  const result = await query<{ event_type: string; count: string }>(
    `SELECT 
       COALESCE((metadata->>'action')::text, event_type) as event_type,
       COUNT(*)::text as count
     FROM events
     WHERE client_id = $1 
       AND created_at > CURRENT_TIMESTAMP - INTERVAL '1 hour' * $2
       AND event_type IN ('pause', 'resume', 'optimize', 'reduce_volume', 'increase_volume')
     GROUP BY event_type
     ORDER BY count DESC`,
    [clientId, hoursBack]
  )
  
  return result.rows.map(
    (r) => `${r.event_type}: ${r.count} actions`
  )
}

async function getDomainStatus(clientId: number): Promise<{ active: number; warming: number; paused: number }> {
  const result = await query<{ status: string; count: string }>(
    `SELECT status, COUNT(*)::text as count FROM domains WHERE client_id = $1 GROUP BY status`,
    [clientId]
  )
  
  const status = { active: 0, warming: 0, paused: 0 }
  for (const row of result.rows) {
    if (row.status === 'active') status.active = Number(row.count)
    if (row.status === 'warming') status.warming = Number(row.count)
    if (row.status === 'paused') status.paused = Number(row.count)
  }
  
  return status
}

export async function generateDailyReport(clientId: number): Promise<DailyReport> {
  const now = new Date()
  const today = now.toISOString().split('T')[0]
  
  // Collect metrics
  const packet = await collectSystemMetrics(clientId)
  const metrics = packet.metrics
  
  // Get system actions from last 24 hours
  const actions = await getSystemActions(clientId, 24)
  
  // Get domain status
  const domainsStatus = await getDomainStatus(clientId)
  
  // Detect anomalies based on metrics
  const anomalies: string[] = []
  if (metrics.bounceRate > 5) {
    anomalies.push(`High bounce rate: ${metrics.bounceRate}%`)
  }
  if (metrics.replyRate < 1 && metrics.sentCount > 100) {
    anomalies.push(`Low reply rate: ${metrics.replyRate}%`)
  }
  if (metrics.sentCount === 0) {
    anomalies.push('No emails sent in last 24 hours')
  }
  
  return {
    date: today,
    clientId,
    emailsSent: metrics.sentCount,
    repliesReceived: metrics.replyCount,
    bounceCount: metrics.bounceCount,
    bounceRate: metrics.bounceRate,
    replyRate: metrics.replyRate,
    positiveReplyRate: metrics.positiveReplyRate,
    systemActions: actions,
    domainsStatus,
    anomaliesDetected: anomalies,
  }
}

export async function formatReportForTelegram(report: DailyReport): Promise<string> {
  const lines: string[] = [
    `📊 Sovereign Engine Daily Report - ${report.date}`,
    ``,
    `📤 **Sending**`,
    `  Emails sent: ${report.emailsSent}`,
    `  Bounce rate: ${report.bounceRate}%`,
    `  Bounces: ${report.bounceCount}`,
    ``,
    `💬 **Engagement**`,
    `  Replies: ${report.repliesReceived}`,
    `  Reply rate: ${report.replyRate}%`,
    `  Positive replies: ${report.positiveReplyRate}%`,
    ``,
    `🌐 **Domain Health**`,
    `  Active: ${report.domainsStatus.active}`,
    `  Warming: ${report.domainsStatus.warming}`,
    `  Paused: ${report.domainsStatus.paused}`,
    ``,
  ]
  
  if (report.systemActions.length > 0) {
    lines.push(`🔧 **System Actions**`)
    for (const action of report.systemActions) {
      lines.push(`  • ${action}`)
    }
    lines.push(``)
  }
  
  if (report.anomaliesDetected.length > 0) {
    lines.push(`⚠️ **Anomalies Detected**`)
    for (const anomaly of report.anomaliesDetected) {
      lines.push(`  • ${anomaly}`)
    }
    lines.push(``)
  }
  
  // Add emoji indicators
  if (report.bounceRate > 5) {
    lines.push(`🚨 High bounce rate detected - domain may need review`)
  } else if (report.bounceRate > 3) {
    lines.push(`⚠️ Elevated bounce rate - monitor closely`)
  } else if (report.bounceRate === 0 && report.emailsSent > 0) {
    lines.push(`✅ Perfect bounce rate!`)
  }
  
  if (report.replyRate > 5) {
    lines.push(`🎉 Excellent reply rate!`)
  } else if (report.replyRate < 1 && report.emailsSent > 100) {
    lines.push(`📉 Low reply rate - consider optimizing message`)
  }
  
  return lines.join('\n')
}

export async function sendTelegramReport(clientId: number, chatId: string): Promise<boolean> {
  const botToken = appEnv.telegramBotToken()
  
  if (!botToken) {
    console.warn('[Telegram] No bot token configured')
    return false
  }
  
  try {
    const report = await generateDailyReport(clientId)
    const message = await formatReportForTelegram(report)
    
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
      }),
    })
    
    if (!response.ok) {
      console.error('[Telegram] Failed to send report:', await response.text())
      return false
    }
    
    console.log(`[Telegram] Report sent to ${chatId}`)
    return true
  } catch (error) {
    console.error('[Telegram] Error sending report:', error)
    return false
  }
}

/**
 * Get Telegram chat ID from user settings or config
 * This would be stored in a users table or env variable
 */
export async function getUserTelegramChatId(clientId: number): Promise<string | null> {
  // Check if stored in database
  const result = await queryOne<{ telegram_chat_id: string }>(
    `SELECT telegram_chat_id FROM client_users WHERE client_id = $1 AND telegram_chat_id IS NOT NULL LIMIT 1`,
    [clientId]
  )
  
  return result?.telegram_chat_id ?? null
}

/**
 * Schedule daily reports (would be called by cron)
 */
export async function scheduleDailyReports(): Promise<void> {
  console.log('[Telegram] Scheduling daily reports...')
  
  // Get all clients with Telegram chat IDs
  const clients = await query<{ client_id: string; telegram_chat_id: string }>(
    `SELECT DISTINCT client_id, telegram_chat_id FROM client_users WHERE telegram_chat_id IS NOT NULL`,
    []
  )
  
  for (const client of clients.rows) {
    const clientId = Number(client.client_id)
    const chatId = client.telegram_chat_id
    
    try {
      await sendTelegramReport(clientId, chatId)
    } catch (error) {
      console.error(`[Telegram] Error sending report for client ${clientId}:`, error)
    }
  }
}
