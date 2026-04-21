import { query } from '@/lib/db'
import { getDomainHealth } from '@/lib/delivery/intelligence'

export interface WarmupSchedule {
  day: number
  min: number
  max: number
}

const SCHEDULE: WarmupSchedule[] = [
  { day: 1, min: 20, max: 50 },
  { day: 2, min: 20, max: 50 },
  { day: 3, min: 20, max: 50 },
  { day: 4, min: 100, max: 300 },
  { day: 5, min: 100, max: 300 },
  { day: 6, min: 100, max: 300 },
  { day: 7, min: 100, max: 300 },
  { day: 8, min: 500, max: 1000 },
  { day: 9, min: 500, max: 1000 },
  { day: 10, min: 500, max: 1000 },
  { day: 11, min: 500, max: 1000 },
  { day: 12, min: 500, max: 1000 },
  { day: 13, min: 500, max: 1000 },
  { day: 14, min: 500, max: 1000 },
]

export async function getWarmupDailyCap(clientId: number, domainId: number): Promise<number> {
  const domain = await query<{ created_at: string }>(
    `SELECT created_at FROM domains WHERE client_id = $1 AND id = $2 LIMIT 1`,
    [clientId, domainId]
  )
  const createdAt = domain.rows[0]?.created_at
  if (!createdAt) return 0

  const ageDays = Math.max(1, Math.ceil((Date.now() - new Date(createdAt).getTime()) / 86400000))
  const entry = SCHEDULE.find((s) => s.day === Math.min(14, ageDays)) ?? SCHEDULE[SCHEDULE.length - 1]!
  // Use max of bracket; control loop will still throttle based on health.
  return entry.max
}

export async function shouldPauseWarmup(clientId: number, domainId: number): Promise<boolean> {
  const rates = await query<{ bounce_rate: number; reply_rate: number; spam_signals: number }>(
    `
    SELECT
      COALESCE(AVG(CASE WHEN event_type = 'bounce' THEN 1 ELSE 0 END)::float, 0) AS bounce_rate,
      COALESCE(AVG(CASE WHEN event_type = 'reply' THEN 1 ELSE 0 END)::float, 0) AS reply_rate,
      0::float AS spam_signals
    FROM events
    WHERE client_id = $1 AND domain_id = $2 AND created_at > NOW() - INTERVAL '24 hours'
    `,
    [clientId, domainId]
  )
  const row = rates.rows[0]
  if (!row) return false

  const health = getDomainHealth({
    bounce_rate: Number(row.bounce_rate) || 0,
    reply_rate: Number(row.reply_rate) || 0,
    spam_signals: Number(row.spam_signals) || 0,
  })
  return health.mode === 'pause'
}

