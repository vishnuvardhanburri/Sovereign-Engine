import type { DbExecutor, TrackingIngestEvent } from '@sovereign/types'

export type OutcomeDecision = 'send_now' | 'slow_lane' | 'defer' | 'drop' | 'unknown'

export type OutcomeContext = {
  traceId?: string
  decision?: OutcomeDecision
  lane?: string
  domainId?: number
  identityId?: number
  timeWindowHour?: number
  leadId?: number
  contactId?: number
  campaignId?: number
  queueJobId?: number
}

export type NormalizedOutcomeEvent = {
  type: TrackingIngestEvent['type']
  clientId: number
  occurredAt?: string
  context: OutcomeContext
}

function safeJson(value: unknown): any {
  if (!value) return null
  if (typeof value === 'object') return value as any
  try {
    return JSON.parse(String(value))
  } catch {
    return null
  }
}

export async function normalizeFromTracking(deps: { db: DbExecutor }, event: TrackingIngestEvent): Promise<NormalizedOutcomeEvent> {
  const ctx: OutcomeContext = {
    contactId: event.contactId ?? undefined,
    leadId: event.contactId ?? undefined,
    campaignId: event.campaignId ?? undefined,
    queueJobId: event.queueJobId ?? undefined,
    domainId: event.domainId ?? undefined,
    identityId: event.identityId ?? undefined,
  }

  const meta = (event.metadata ?? {}) as any
  if (meta.traceId) ctx.traceId = String(meta.traceId)
  if (meta.lane) ctx.lane = String(meta.lane)

  // If we have a queue job, it is the most reliable link to decision + traceId
  // because pre-enqueue writes metadata.advanced_trace + metadata.delivery.override_lane.
  if (event.queueJobId) {
    const res = await deps.db<{ metadata: any; scheduled_at: string | null }>(
      `SELECT metadata, scheduled_at
       FROM queue_jobs
       WHERE client_id = $1 AND id = $2
       LIMIT 1`,
      [event.clientId, event.queueJobId]
    )
    const row = res.rows[0]
    const jobMeta = safeJson(row?.metadata) ?? {}
    const trace = jobMeta.advanced_trace ?? jobMeta.advancedTrace ?? null
    if (!ctx.traceId && trace?.traceId) ctx.traceId = String(trace.traceId)

    const overrideLane = jobMeta?.delivery?.override_lane
    if (!ctx.lane && overrideLane) ctx.lane = String(overrideLane)

    // Best-effort: map the last pre-enqueue decision to a normalized "decision".
    const rawDecision = trace?.decision?.action ?? trace?.decision?.action_type ?? trace?.decision
    if (rawDecision && !ctx.decision) {
      const v = String(rawDecision)
      if (v.includes('drop')) ctx.decision = 'drop'
      else if (v.includes('defer') || v.includes('send_later')) ctx.decision = 'defer'
      else if (v.includes('slow')) ctx.decision = 'slow_lane'
      else if (v.includes('send')) ctx.decision = 'send_now'
    }

    if (!ctx.timeWindowHour && row?.scheduled_at) {
      const d = new Date(row.scheduled_at)
      if (!Number.isNaN(d.getTime())) ctx.timeWindowHour = d.getHours()
    }
  }

  return {
    type: event.type,
    clientId: event.clientId,
    occurredAt: event.occurredAt ? new Date(event.occurredAt).toISOString() : undefined,
    context: ctx,
  }
}

