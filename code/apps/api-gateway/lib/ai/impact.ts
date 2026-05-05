import { query } from '@/lib/db'
import { appEnv } from '@/lib/env'
import type { CopilotSystemContext } from '@/lib/ai/system-context'

export type ImpactActionKind =
  | 'adjust_send_rate'
  | 'rotate_patterns'
  | 'retry_queue'
  | 'optimize'
  | 'heal'
  | 'pause_campaign'

export interface ImpactRecord {
  id: string
  client_id: number
  action_kind: ImpactActionKind
  action_summary: string
  action_payload: any
  before_snapshot: CopilotSystemContext
  after_snapshot: CopilotSystemContext
  created_at: string
}

function idLike(): string {
  const rnd = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0')
  return `imp_${rnd()}${rnd()}`
}

function pctChange(before: number, after: number): number {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return 0
  if (before === 0) return after === 0 ? 0 : 1
  return (after - before) / before
}

export function summarizeImpact(before: CopilotSystemContext, after: CopilotSystemContext): string[] {
  const lines: string[] = []

  const bBounce = before.performance.last24h.bounceRate
  const aBounce = after.performance.last24h.bounceRate
  const bReply = before.performance.last24h.replyRate
  const aReply = after.performance.last24h.replyRate

  const bounceDelta = pctChange(Math.max(bBounce, 0.000001), Math.max(aBounce, 0.000001))
  const replyDelta = pctChange(Math.max(bReply, 0.000001), Math.max(aReply, 0.000001))

  if (Math.abs(bounceDelta) >= 0.05) {
    const dir = bounceDelta < 0 ? 'Reduced' : 'Increased'
    lines.push(`${dir} bounce rate by ${Math.round(Math.abs(bounceDelta) * 100)}%`)
  }

  if (Math.abs(replyDelta) >= 0.05) {
    const dir = replyDelta > 0 ? 'Improved' : 'Reduced'
    lines.push(`${dir} reply rate by ${Math.round(Math.abs(replyDelta) * 100)}%`)
  }

  const recoveredDomains =
    before.domains.filter((d) => d.status === 'paused' || d.pausedFlag).length -
    after.domains.filter((d) => d.status === 'paused' || d.pausedFlag).length

  if (recoveredDomains > 0) {
    lines.push(`Recovered ${recoveredDomains} domain(s)`)
  }

  if (lines.length === 0) {
    lines.push('No measurable impact yet (waiting for new telemetry).')
  }

  return lines
}

export async function recordImpact(input: {
  clientId?: number
  actionKind: ImpactActionKind
  actionSummary: string
  actionPayload: any
  before: CopilotSystemContext
  after: CopilotSystemContext
}): Promise<ImpactRecord> {
  const clientId = input.clientId ?? appEnv.defaultClientId()
  const id = idLike()

  const inserted = await query<any>(
    `
    INSERT INTO copilot_action_impacts (
      id,
      client_id,
      action_kind,
      action_summary,
      action_payload,
      before_snapshot,
      after_snapshot
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING id, client_id, action_kind, action_summary, action_payload, before_snapshot, after_snapshot, created_at
  `,
    [
      id,
      clientId,
      input.actionKind,
      input.actionSummary,
      JSON.stringify(input.actionPayload ?? null),
      JSON.stringify(input.before),
      JSON.stringify(input.after),
    ],
  )

  const row = inserted.rows[0]
  return {
    id: String(row.id),
    client_id: Number(row.client_id),
    action_kind: row.action_kind,
    action_summary: String(row.action_summary),
    action_payload: row.action_payload,
    before_snapshot: row.before_snapshot,
    after_snapshot: row.after_snapshot,
    created_at: new Date(row.created_at).toISOString(),
  }
}

export async function listImpacts(input?: {
  clientId?: number
  limit?: number
}): Promise<ImpactRecord[]> {
  const clientId = input?.clientId ?? appEnv.defaultClientId()
  const limit = Math.max(1, Math.min(100, input?.limit ?? 10))

  const res = await query<any>(
    `
    SELECT id, client_id, action_kind, action_summary, action_payload, before_snapshot, after_snapshot, created_at
    FROM copilot_action_impacts
    WHERE client_id = $1
    ORDER BY created_at DESC
    LIMIT $2
  `,
    [clientId, limit],
  )

  return res.rows.map((r: any) => ({
    id: String(r.id),
    client_id: Number(r.client_id),
    action_kind: r.action_kind,
    action_summary: String(r.action_summary),
    action_payload: r.action_payload,
    before_snapshot: r.before_snapshot,
    after_snapshot: r.after_snapshot,
    created_at: new Date(r.created_at).toISOString(),
  }))
}

