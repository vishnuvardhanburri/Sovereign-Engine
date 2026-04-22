import { query } from '@/lib/db'
import { appEnv } from '@/lib/env'

export type CopilotMemoryScope = 'global' | 'client' | 'campaign' | 'domain'

export interface CopilotMemoryRecord {
  id: string
  client_id: number
  scope: CopilotMemoryScope
  scope_key: string | null
  kind: string
  payload: any
  created_at: string
}

export interface CopilotProposal {
  id: string
  client_id: number
  status: 'pending' | 'executed' | 'cancelled'
  summary: string
  proposed_actions: any
  created_at: string
  confirmed_at: string | null
  executed_at: string | null
}

function uuidLike(): string {
  // Deterministic-ish local UUID: sufficient for local DB keys.
  const rnd = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0')
  return `cop_${rnd()}${rnd()}${rnd()}`
}

export async function remember(input: {
  clientId?: number
  scope?: CopilotMemoryScope
  scopeKey?: string | null
  kind: string
  payload: any
}): Promise<CopilotMemoryRecord> {
  const clientId = input.clientId ?? appEnv.defaultClientId()
  const scope = input.scope ?? 'client'
  const scopeKey = input.scopeKey ?? null

  const inserted = await query<any>(
    `
    INSERT INTO copilot_memory (id, client_id, scope, scope_key, kind, payload)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, client_id, scope, scope_key, kind, payload, created_at
  `,
    [uuidLike(), clientId, scope, scopeKey, input.kind, JSON.stringify(input.payload ?? null)],
  )

  const row = inserted.rows[0]
  return {
    id: String(row.id),
    client_id: Number(row.client_id),
    scope: row.scope,
    scope_key: row.scope_key ? String(row.scope_key) : null,
    kind: String(row.kind),
    payload: row.payload,
    created_at: new Date(row.created_at).toISOString(),
  }
}

export async function listMemory(input?: {
  clientId?: number
  scope?: CopilotMemoryScope
  scopeKey?: string | null
  kind?: string
  limit?: number
}): Promise<CopilotMemoryRecord[]> {
  const clientId = input?.clientId ?? appEnv.defaultClientId()
  const limit = Math.max(1, Math.min(200, input?.limit ?? 50))

  const rows = await query<any>(
    `
    SELECT id, client_id, scope, scope_key, kind, payload, created_at
    FROM copilot_memory
    WHERE client_id = $1
      AND ($2::text IS NULL OR scope = $2)
      AND ($3::text IS NULL OR scope_key = $3)
      AND ($4::text IS NULL OR kind = $4)
    ORDER BY created_at DESC
    LIMIT $5
  `,
    [clientId, input?.scope ?? null, input?.scopeKey ?? null, input?.kind ?? null, limit],
  )

  return rows.rows.map((r: any) => ({
    id: String(r.id),
    client_id: Number(r.client_id),
    scope: r.scope,
    scope_key: r.scope_key ? String(r.scope_key) : null,
    kind: String(r.kind),
    payload: r.payload,
    created_at: new Date(r.created_at).toISOString(),
  }))
}

export async function createProposal(input: {
  clientId?: number
  summary: string
  proposedActions: any
}): Promise<CopilotProposal> {
  const clientId = input.clientId ?? appEnv.defaultClientId()
  const summary = String(input.summary ?? '').trim()
  const proposedActions = input.proposedActions ?? []

  const inserted = await query<any>(
    `
    INSERT INTO copilot_proposals (id, client_id, status, summary, proposed_actions)
    VALUES ($1, $2, 'pending', $3, $4)
    RETURNING id, client_id, status, summary, proposed_actions, created_at, confirmed_at, executed_at
  `,
    [uuidLike(), clientId, summary || 'Copilot proposal', JSON.stringify(proposedActions)],
  )

  const row = inserted.rows[0]
  return {
    id: String(row.id),
    client_id: Number(row.client_id),
    status: row.status,
    summary: String(row.summary),
    proposed_actions: row.proposed_actions,
    created_at: new Date(row.created_at).toISOString(),
    confirmed_at: row.confirmed_at ? new Date(row.confirmed_at).toISOString() : null,
    executed_at: row.executed_at ? new Date(row.executed_at).toISOString() : null,
  }
}

export async function getProposal(id: string): Promise<CopilotProposal | null> {
  const found = await query<any>(
    `
    SELECT id, client_id, status, summary, proposed_actions, created_at, confirmed_at, executed_at
    FROM copilot_proposals
    WHERE id = $1
    LIMIT 1
  `,
    [id],
  )
  const row = found.rows[0]
  if (!row) return null
  return {
    id: String(row.id),
    client_id: Number(row.client_id),
    status: row.status,
    summary: String(row.summary),
    proposed_actions: row.proposed_actions,
    created_at: new Date(row.created_at).toISOString(),
    confirmed_at: row.confirmed_at ? new Date(row.confirmed_at).toISOString() : null,
    executed_at: row.executed_at ? new Date(row.executed_at).toISOString() : null,
  }
}

export async function confirmProposal(id: string): Promise<void> {
  await query(
    `
    UPDATE copilot_proposals
    SET confirmed_at = NOW()
    WHERE id = $1 AND status = 'pending' AND confirmed_at IS NULL
  `,
    [id],
  )
}

export async function markProposalExecuted(id: string): Promise<void> {
  await query(
    `
    UPDATE copilot_proposals
    SET status = 'executed', executed_at = NOW()
    WHERE id = $1 AND status = 'pending'
  `,
    [id],
  )
}

