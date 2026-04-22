import { queryOne } from '@/lib/db'
import { appEnv } from '@/lib/env'

export type DeliverabilityStatus = 'STABLE' | 'RISK' | 'DEGRADED'

export interface SystemGuaranteesSnapshot {
  timestamp: string
  deliverabilityStatus: DeliverabilityStatus
  uptime24hPct: number
  errorRatePct24h: number
  counts24h: {
    sent: number
    failed: number
    bounce: number
    complaint: number
    unsubscribed: number
  }
  compliance: {
    violationsDetected: boolean
    complaintCount24h: number
    unsubscribedCount24h: number
  }
}

function n(value: unknown): number {
  const out = Number(value)
  return Number.isFinite(out) ? out : 0
}

function ratePct(num: number, den: number): number {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return 0
  return (num / den) * 100
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

function deliverabilityLabel(input: { bouncePct: number; complaintPct: number; failedPct: number }): DeliverabilityStatus {
  // Conservative deterministic boundary:
  // - complaints are a hard red line (ISP feedback loops)
  // - bounces above 5% is generally unsafe
  if (input.complaintPct >= 0.2) return 'DEGRADED'
  if (input.bouncePct >= 5) return 'DEGRADED'
  if (input.failedPct >= 5) return 'RISK'
  if (input.bouncePct >= 3 || input.complaintPct > 0) return 'RISK'
  return 'STABLE'
}

export async function buildSystemGuarantees(input?: { clientId?: number }): Promise<SystemGuaranteesSnapshot> {
  const clientId = input?.clientId ?? appEnv.defaultClientId()

  const counts = await queryOne<{
    sent: string | number | null
    failed: string | number | null
    bounce: string | number | null
    complaint: string | number | null
    unsubscribed: string | number | null
  }>(
    `
    SELECT
      COUNT(*) FILTER (WHERE event_type = 'sent')::text AS sent,
      COUNT(*) FILTER (WHERE event_type = 'failed')::text AS failed,
      COUNT(*) FILTER (WHERE event_type = 'bounce')::text AS bounce,
      COUNT(*) FILTER (WHERE event_type = 'complaint')::text AS complaint,
      COUNT(*) FILTER (WHERE event_type = 'unsubscribed')::text AS unsubscribed
    FROM events
    WHERE client_id = $1
      AND created_at > NOW() - INTERVAL '24 hours'
    `,
    [clientId],
  )

  const sent = n(counts?.sent)
  const failed = n(counts?.failed)
  const bounce = n(counts?.bounce)
  const complaint = n(counts?.complaint)
  const unsubscribed = n(counts?.unsubscribed)

  const bouncePct = ratePct(bounce, sent)
  const complaintPct = ratePct(complaint, sent)
  const failedPct = ratePct(failed, sent)
  const errorRatePct24h = clamp(ratePct(failed + bounce + complaint, Math.max(sent, 1)), 0, 100)

  const deliverabilityStatus = deliverabilityLabel({ bouncePct, complaintPct, failedPct })

  const uptime = await queryOne<{ uptime: string | number | null }>(
    `
    SELECT
      COALESCE(AVG(metric_value), 100)::text AS uptime
    FROM system_metrics
    WHERE client_id = $1
      AND metric_name = 'uptime'
      AND created_at > NOW() - INTERVAL '24 hours'
    `,
    [clientId],
  )

  // If no uptime samples exist, treat as 100 (local/dev typically).
  const uptime24hPct = clamp(n(uptime?.uptime) || 100, 0, 100)

  return {
    timestamp: new Date().toISOString(),
    deliverabilityStatus,
    uptime24hPct: Math.round(uptime24hPct * 10) / 10,
    errorRatePct24h: Math.round(errorRatePct24h * 100) / 100,
    counts24h: {
      sent,
      failed,
      bounce,
      complaint,
      unsubscribed,
    },
    compliance: {
      violationsDetected: complaint > 0,
      complaintCount24h: complaint,
      unsubscribedCount24h: unsubscribed,
    },
  }
}

