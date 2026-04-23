import { query, transaction } from '@/lib/db'
import { appEnv } from '@/lib/env'
import { buildSystemContext } from '@/lib/ai/system-context'
import { loadPatternStore } from '@/lib/ai/pattern-memory'
import { promoteReadyQueueJobs } from '@/lib/backend'

export type CopilotToolResult<T> = { ok: true; data: T } | { ok: false; error: string }

function asInt(value: unknown): number | null {
  const n = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value)
  if (!Number.isFinite(n)) return null
  return Math.trunc(n)
}

export async function getCampaignStats(input?: { clientId?: number }) {
  const ctx = await buildSystemContext({ clientId: input?.clientId })
  return ctx.campaigns
}

export async function getDomainHealth(input?: { clientId?: number }) {
  const ctx = await buildSystemContext({ clientId: input?.clientId })
  return ctx.domains
}

export async function getSystemRisk(input?: { clientId?: number }) {
  const ctx = await buildSystemContext({ clientId: input?.clientId })
  return {
    systemStatus: ctx.systemStatus,
    riskLevel: ctx.riskLevel,
    infraRisk: ctx.infraRisk,
    queue: ctx.queue,
    last24h: ctx.performance.last24h,
  }
}

export async function getTopPatterns(input?: { limit?: number }) {
  const store = await loadPatternStore()
  const limit = Math.max(1, Math.min(50, input?.limit ?? 10))
  return store.patterns
    .slice()
    .filter((p) => p.status !== 'disabled')
    .sort((a, b) => (b.score - a.score) || (b.reply_rate - a.reply_rate) || (b.open_rate - a.open_rate))
    .slice(0, limit)
}

/**
 * WRITE TOOLS
 *
 * These are intentionally low-level and do NOT implement approval. Approval is enforced by the orchestrator.
 */

export async function createCampaign(input: {
  clientId?: number
  name: string
  sequenceId: number
  status?: 'draft' | 'active' | 'paused' | 'completed'
  dailyTarget?: number
}): Promise<CopilotToolResult<{ id: number }>> {
  const clientId = input.clientId ?? appEnv.defaultClientId()
  const name = String(input.name ?? '').trim()
  const sequenceId = asInt(input.sequenceId)

  if (!name) return { ok: false, error: 'Campaign name is required' }
  if (!sequenceId) return { ok: false, error: 'sequenceId is required' }

  const status = input.status ?? 'draft'
  const dailyTarget = Math.max(1, Math.min(5000, asInt(input.dailyTarget) ?? 50))

  const inserted = await query<{ id: number }>(
    `
    INSERT INTO campaigns (client_id, sequence_id, name, status, daily_target)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id
  `,
    [clientId, sequenceId, name, status, dailyTarget],
  )

  return { ok: true, data: { id: Number(inserted.rows[0]?.id) } }
}

export async function pauseCampaign(input: {
  clientId?: number
  campaignId: number
  reason?: string
}): Promise<CopilotToolResult<{ campaignId: number; status: string }>> {
  const clientId = input.clientId ?? appEnv.defaultClientId()
  const campaignId = asInt(input.campaignId)
  if (!campaignId) return { ok: false, error: 'campaignId is required' }

  const updated = await query<any>(
    `
    UPDATE campaigns
    SET status = 'paused', updated_at = NOW()
    WHERE client_id = $1 AND id = $2
    RETURNING id, status
  `,
    [clientId, campaignId],
  )

  if (!updated.rows[0]) return { ok: false, error: 'Campaign not found' }

  // Log operator action.
  await query(
    `
    INSERT INTO operator_actions (client_id, campaign_id, action_type, summary, payload)
    VALUES ($1, $2, 'copilot.pause_campaign', $3, $4)
  `,
    [
      clientId,
      campaignId,
      `Paused campaign via copilot${input.reason ? `: ${input.reason}` : ''}`,
      JSON.stringify({ reason: input.reason ?? null }),
    ],
  )

  return { ok: true, data: { campaignId, status: String(updated.rows[0].status) } }
}

export async function adjustSendRate(input: {
  clientId?: number
  domainId?: number
  mode: 'reduce_20pct' | 'increase_10pct' | 'set'
  dailyLimit?: number
}): Promise<CopilotToolResult<{ updated: number }>> {
  const clientId = input.clientId ?? appEnv.defaultClientId()

  const dailyLimit = asInt(input.dailyLimit)
  if (input.mode === 'set' && (!dailyLimit || dailyLimit <= 0)) {
    return { ok: false, error: 'dailyLimit must be provided when mode=set' }
  }

  const domainId = input.domainId ? asInt(input.domainId) : null
  const updated = await transaction(async (tx) => {
    const domains = await tx<any>(
      `
      SELECT id, daily_limit
      FROM domains
      WHERE client_id = $1
        ${domainId ? 'AND id = $2' : ''}
      ORDER BY id ASC
    `,
      domainId ? [clientId, domainId] : [clientId],
    )

    let count = 0
    for (const d of domains.rows) {
      const current = Number(d.daily_limit ?? 0) || 0
      let next = current
      if (input.mode === 'reduce_20pct') next = Math.max(1, Math.floor(current * 0.8))
      if (input.mode === 'increase_10pct') next = Math.max(1, Math.floor(current * 1.1))
      if (input.mode === 'set') next = Math.max(1, dailyLimit!)

      if (next === current) continue
      await tx(
        `
        UPDATE domains
        SET daily_limit = $1, updated_at = NOW()
        WHERE client_id = $2 AND id = $3
      `,
        [next, clientId, Number(d.id)],
      )
      count += 1
    }
    return count
  })

  await query(
    `
    INSERT INTO operator_actions (client_id, action_type, summary, payload)
    VALUES ($1, 'copilot.adjust_send_rate', $2, $3)
  `,
    [
      clientId,
      `Adjusted send rate (${input.mode}) on ${updated} domain(s)`,
      JSON.stringify({ ...input, updated }),
    ],
  )

  return { ok: true, data: { updated } }
}

export async function promoteQueue(input?: { clientId?: number }): Promise<CopilotToolResult<{ promoted: number }>> {
  try {
    // promoteReadyQueueJobs is already the canonical path (it handles Redis interactions).
    const promoted = await promoteReadyQueueJobs()
    return { ok: true, data: { promoted: Number(promoted ?? 0) || 0 } }
  } catch (error) {
    console.error('[CopilotTool] promoteQueue failed', error)
    return { ok: false, error: 'Failed to promote queue jobs' }
  }
}

export async function retryFailedQueueJobs(input?: {
  clientId?: number
  limit?: number
}): Promise<CopilotToolResult<{ retried: number }>> {
  const clientId = input?.clientId ?? appEnv.defaultClientId()
  const limit = Math.max(1, Math.min(500, asInt(input?.limit) ?? 100))

  const updated = await query<any>(
    `
    WITH candidates AS (
      SELECT id
      FROM queue_jobs
      WHERE client_id = $1
        AND status = 'failed'
        AND attempts < max_attempts
      ORDER BY updated_at DESC
      LIMIT $2
    )
    UPDATE queue_jobs
    SET status = 'retry', updated_at = NOW()
    WHERE id IN (SELECT id FROM candidates)
    RETURNING id
  `,
    [clientId, limit],
  )

  const retried = updated.rowCount ?? updated.rows.length

  await query(
    `
    INSERT INTO operator_actions (client_id, action_type, summary, payload)
    VALUES ($1, 'copilot.retry_failed_jobs', $2, $3)
  `,
    [clientId, `Moved ${retried} failed job(s) back to retry`, JSON.stringify({ retried, limit })],
  )

  return { ok: true, data: { retried } }
}

export async function updateSequence(input: {
  clientId?: number
  sequenceId: number
  name?: string
  steps?: Array<{ stepIndex: number; dayDelay?: number; subject: string; body: string }>
}): Promise<CopilotToolResult<{ sequenceId: number }>> {
  const clientId = input.clientId ?? appEnv.defaultClientId()
  const sequenceId = asInt(input.sequenceId)
  if (!sequenceId) return { ok: false, error: 'sequenceId is required' }

  return transaction(async (tx) => {
    const exists = await tx<any>(
      `SELECT id FROM sequences WHERE client_id = $1 AND id = $2`,
      [clientId, sequenceId],
    )
    if (!exists.rows[0]) return { ok: false, error: 'Sequence not found' }

    if (input.name && String(input.name).trim()) {
      await tx(
        `UPDATE sequences SET name = $1, updated_at = NOW() WHERE client_id = $2 AND id = $3`,
        [String(input.name).trim(), clientId, sequenceId],
      )
    }

    if (input.steps && input.steps.length > 0) {
      for (const step of input.steps) {
        const stepIndex = asInt(step.stepIndex)
        if (!stepIndex || stepIndex < 0) continue

        const subject = String(step.subject ?? '').trim()
        const body = String(step.body ?? '').trim()
        if (!subject || !body) continue

        const dayDelay = Math.max(0, asInt(step.dayDelay) ?? 0)

        await tx(
          `
          INSERT INTO sequence_steps (sequence_id, step_index, day_delay, subject, body)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (sequence_id, step_index) DO UPDATE
          SET day_delay = EXCLUDED.day_delay,
              subject = EXCLUDED.subject,
              body = EXCLUDED.body,
              updated_at = NOW()
        `,
          [sequenceId, stepIndex, dayDelay, subject, body],
        )
      }
    }

    await tx(
      `
      INSERT INTO operator_actions (client_id, action_type, summary, payload)
      VALUES ($1, 'copilot.update_sequence', $2, $3)
    `,
      [
        clientId,
        `Updated sequence ${sequenceId} via copilot`,
        JSON.stringify({ sequenceId, name: input.name ?? null, stepsCount: input.steps?.length ?? 0 }),
      ],
    )

    return { ok: true, data: { sequenceId } }
  })
}

export async function createAndLaunchCampaign(input: {
  clientId?: number
  name: string
  sequenceId: number
  dailyTarget?: number
  contactIds: number[]
}): Promise<CopilotToolResult<{ campaignId: number; contactCount: number }>> {
  const clientId = input.clientId ?? appEnv.defaultClientId()
  const name = String(input.name ?? '').trim()
  const sequenceId = asInt(input.sequenceId)
  if (!name) return { ok: false, error: 'Campaign name is required' }
  if (!sequenceId) return { ok: false, error: 'sequenceId is required' }

  const contactIds = Array.isArray(input.contactIds) ? input.contactIds.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0) : []
  if (contactIds.length === 0) return { ok: false, error: 'No eligible contacts found for the provided filters' }
  if (contactIds.length > 50_000) return { ok: false, error: 'Too many contacts selected (max 50,000)' }

  const dailyTarget = Math.max(1, Math.min(5000, asInt(input.dailyTarget) ?? 200))

  try {
    // Reuse existing backend orchestration which handles queue job insertion + status activation.
    const backend = await import('@/lib/backend')
    const created = await backend.createCampaign(clientId, { name, sequenceId, dailyTarget })
    const campaignId = Number((created as any)?.id)
    if (!campaignId) return { ok: false, error: 'Failed to create campaign' }

    const payload = await backend.enqueueCampaignJobs(clientId, campaignId, contactIds)

    await query(
      `
      INSERT INTO operator_actions (client_id, campaign_id, action_type, summary, payload)
      VALUES ($1, $2, 'copilot.create_and_launch_campaign', $3, $4)
    `,
      [
        clientId,
        campaignId,
        `Created and launched campaign via command center: ${name}`,
        JSON.stringify({ sequenceId, dailyTarget, requestedContacts: contactIds.length, enqueuedContacts: payload.contactCount }),
      ],
    )

    return { ok: true, data: { campaignId, contactCount: Number(payload.contactCount ?? 0) || 0 } }
  } catch (error) {
    console.error('[CopilotTool] createAndLaunchCampaign failed', error)
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to create and launch campaign' }
  }
}
