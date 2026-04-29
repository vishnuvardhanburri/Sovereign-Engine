import { z } from 'zod'
import { query } from '@/lib/db'
import { appEnv } from '@/lib/env'
import { buildSystemContext } from '@/lib/ai/system-context'
import { loadPatternStore } from '@/lib/ai/pattern-memory'
import { createProposal, remember } from '@/lib/ai/memory'
import type { ParsedCommand, CommandFilters } from '@/lib/ai/command-parser'

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'

export const ExecutionPlanSchema = z.object({
  planId: z.string(),
  command: z.any(),
  systemStatus: z.string(),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  contactCount: z.number().int().min(0),
  projectedDailySend: z.number().int().min(0),
  estimatedDurationDays: z.number().int().min(0),
  domainUsage: z.array(
    z.object({
      domainId: z.number().int(),
      domain: z.string(),
      dailyLimit: z.number().int(),
      projectedSend: z.number().int(),
      healthScore: z.number(),
    }),
  ),
  expectedReplyRateRangePct: z.tuple([z.number(), z.number()]),
  expectedRepliesRange: z.tuple([z.number().int(), z.number().int()]),
  actions: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      detail: z.string(),
      tool: z.string(),
      args: z.record(z.any()),
      requiresApproval: z.literal(true),
    }),
  ),
})

export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function toRiskLevel(input: string): RiskLevel {
  const v = String(input ?? '').toUpperCase()
  if (v === 'HIGH') return 'HIGH'
  if (v === 'MEDIUM') return 'MEDIUM'
  return 'LOW'
}

function buildContactWhere(filters?: CommandFilters): { where: string; params: unknown[] } {
  const f = filters ?? {}
  const clauses: string[] = []
  const params: unknown[] = []

  const push = (sql: string, value?: unknown) => {
    if (value === undefined) return
    params.push(value)
    clauses.push(sql.replaceAll('$X', `$${params.length}`))
  }

  push('c.client_id = $X', appEnv.defaultClientId())

  if (f.statusIn?.length) push(`c.status = ANY($X::text[])`, f.statusIn)
  if (f.verificationStatusIn?.length) push(`c.verification_status = ANY($X::text[])`, f.verificationStatusIn)

  if (f.titleContains) push(`c.title ILIKE $X`, `%${f.titleContains}%`)
  if (f.companyContains) push(`c.company ILIKE $X`, `%${f.companyContains}%`)
  if (f.timezoneIn?.length) push(`c.timezone = ANY($X::text[])`, f.timezoneIn)

  if (f.emailDomainIn?.length) push(`c.email_domain = ANY($X::text[])`, f.emailDomainIn)
  if (f.sourceIn?.length) push(`c.source = ANY($X::text[])`, f.sourceIn)

  // Always exclude suppression list for real execution. (Matches backend eligibility logic.)
  clauses.push(`NOT EXISTS (SELECT 1 FROM suppression_list s WHERE s.client_id = c.client_id AND s.email = c.email)`)

  return { where: clauses.length ? clauses.join(' AND ') : 'TRUE', params }
}

async function estimateContactCount(filters?: CommandFilters): Promise<number> {
  const { where, params } = buildContactWhere(filters)
  const res = await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM contacts c WHERE ${where}`, params)
  return Number(res.rows[0]?.count ?? 0) || 0
}

async function selectContactIds(filters?: CommandFilters): Promise<number[]> {
  const { where, params } = buildContactWhere(filters)
  const limit = clamp(filters?.limit ?? 2000, 1, 50_000)
  const res = await query<{ id: number }>(
    `SELECT c.id
     FROM contacts c
     WHERE ${where}
     ORDER BY c.id ASC
     LIMIT $${params.length + 1}`,
    [...params, limit],
  )
  return res.rows.map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0)
}

function expectedReplyRateRange(patterns: Awaited<ReturnType<typeof loadPatternStore>>): [number, number] {
  const active = patterns.patterns.filter((p) => p.status !== 'disabled')
  if (!active.length) return [2, 5]
  const top = active.slice().sort((a, b) => (b.score - a.score) || (b.reply_rate - a.reply_rate)).slice(0, 5)
  const avg = top.reduce((sum, p) => sum + (Number(p.reply_rate) || 0), 0) / top.length
  const low = clamp(Math.floor(avg * 0.8), 1, 40)
  const high = clamp(Math.ceil(avg * 1.2), low + 1, 60)
  return [low, high]
}

function computeSendPlan(input: {
  contactCount: number
  desiredDailyTarget?: number
  domains: Array<{ id: number; domain: string; daily_limit: number; health_score: number; status: string; paused: boolean }>
  risk: RiskLevel
}) {
  const healthy = input.domains.filter((d) => d.status === 'active' && !d.paused)
  const totalCapacity = healthy.reduce((sum, d) => sum + (Number(d.daily_limit) || 0), 0)
  const safetyMultiplier = input.risk === 'HIGH' ? 0.4 : input.risk === 'MEDIUM' ? 0.7 : 0.9
  const safeCapacity = Math.max(0, Math.floor(totalCapacity * safetyMultiplier))

  const requested = clamp(input.desiredDailyTarget ?? 200, 10, 5000)
  const projectedDailySend = Math.min(requested, safeCapacity, input.contactCount)

  // Distribute across domains proportional to daily_limit.
  const usage = healthy.map((d) => {
    const share = totalCapacity > 0 ? (Number(d.daily_limit) || 0) / totalCapacity : 0
    const projectedSend = Math.floor(projectedDailySend * share)
    return {
      domainId: Number(d.id),
      domain: String(d.domain),
      dailyLimit: Number(d.daily_limit) || 0,
      projectedSend,
      healthScore: Number(d.health_score) || 0,
    }
  })

  // Fix rounding to ensure sum equals projectedDailySend.
  const diff = projectedDailySend - usage.reduce((sum, u) => sum + u.projectedSend, 0)
  if (diff !== 0 && usage.length) {
    usage[0].projectedSend += diff
  }

  const estimatedDurationDays = projectedDailySend > 0 ? Math.ceil(input.contactCount / projectedDailySend) : 0

  return { projectedDailySend, estimatedDurationDays, domainUsage: usage }
}

export async function buildExecutionPlan(input: {
  command: ParsedCommand
  clientId?: number
  mode?: 'auto' | 'manual'
}): Promise<{ ok: true; plan: ExecutionPlan } | { ok: false; error: string }> {
  try {
    const clientId = input.clientId ?? appEnv.defaultClientId()
    const ctx = await buildSystemContext({ clientId })
    const riskLevel = toRiskLevel(ctx.riskLevel)

    if (input.command.action === 'get_status') {
      const proposal = await createProposal({
        clientId,
        summary: 'Status request',
        proposedActions: [],
      })
      return {
        ok: true,
        plan: ExecutionPlanSchema.parse({
          planId: proposal.id,
          command: input.command,
          systemStatus: ctx.systemStatus,
          riskLevel,
          contactCount: 0,
          projectedDailySend: 0,
          estimatedDurationDays: 0,
          domainUsage: [],
          expectedReplyRateRangePct: [0, 0],
          expectedRepliesRange: [0, 0],
          actions: [],
        }),
      }
    }

    if (input.command.action === 'pause_campaign') {
      const campaignId = Number(input.command.params?.campaignId)
      if (!campaignId) return { ok: false, error: 'pause_campaign requires campaignId (e.g. "pause campaign 12")' }

      const proposal = await createProposal({
        clientId,
        summary: `Pause campaign ${campaignId}`,
        proposedActions: [
          {
            id: `act_cmd_${Date.now()}_0`,
            title: `Pause campaign #${campaignId}`,
            detail: 'Stops sending and protects deliverability while investigating.',
            tool: 'pauseCampaign',
            args: { clientId, campaignId, reason: 'Command-driven pause' },
            requiresApproval: true,
          },
        ],
      })

      await remember({
        clientId,
        scope: 'client',
        kind: 'copilot.command_plan_proposed',
        payload: { planId: proposal.id, action: 'pause_campaign', campaignId },
      })

      return {
        ok: true,
        plan: ExecutionPlanSchema.parse({
          planId: proposal.id,
          command: input.command,
          systemStatus: ctx.systemStatus,
          riskLevel,
          contactCount: 0,
          projectedDailySend: 0,
          estimatedDurationDays: 0,
          domainUsage: [],
          expectedReplyRateRangePct: [0, 0],
          expectedRepliesRange: [0, 0],
          actions: proposal.proposed_actions ?? [],
        }),
      }
    }

    // Strict separation: Manual mode can ONLY operate over imported/manual-upload contacts.
    // Auto mode is free to build audiences dynamically unless the user explicitly filters source.
    if (input.mode === 'manual') {
      const audience = input.command.audience ?? {}
      const filters = audience.filters ?? {}
      input.command.audience = {
        ...audience,
        filters: {
          ...filters,
          sourceIn: filters.sourceIn?.length ? filters.sourceIn : ['manual_upload'],
        },
      }
    }

    if (input.command.action === 'adjust_send_rate') {
      const mode = String(input.command.params?.sendRateMode ?? 'reduce_20pct') as any
      const domainId = input.command.params?.domainId ? Number(input.command.params.domainId) : undefined
      const dailyLimit = input.command.params?.dailyLimit ? Number(input.command.params.dailyLimit) : undefined

      const proposal = await createProposal({
        clientId,
        summary: 'Adjust send rate',
        proposedActions: [
          {
            id: `act_cmd_${Date.now()}_0`,
            title: 'Adjust send rate',
            detail: 'Applies a safe rate change to reduce risk while keeping pipeline active.',
            tool: 'adjustSendRate',
            args: { clientId, mode, domainId, dailyLimit },
            requiresApproval: true,
          },
        ],
      })

      await remember({
        clientId,
        scope: 'client',
        kind: 'copilot.command_plan_proposed',
        payload: { planId: proposal.id, action: 'adjust_send_rate', mode, domainId: domainId ?? null },
      })

      return {
        ok: true,
        plan: ExecutionPlanSchema.parse({
          planId: proposal.id,
          command: input.command,
          systemStatus: ctx.systemStatus,
          riskLevel,
          contactCount: 0,
          projectedDailySend: 0,
          estimatedDurationDays: 0,
          domainUsage: [],
          expectedReplyRateRangePct: [0, 0],
          expectedRepliesRange: [0, 0],
          actions: proposal.proposed_actions ?? [],
        }),
      }
    }

    // create_campaign (command-driven outbound)
    const sequenceId = input.command.params?.sequenceId ? Number(input.command.params.sequenceId) : undefined
    if (!sequenceId) return { ok: false, error: 'create_campaign requires sequenceId (e.g. "create campaign ... sequence:1")' }

    const filters = input.command.audience?.filters
    const enforcedFilters: CommandFilters | undefined =
      input.mode === 'manual'
        ? {
            ...(filters ?? {}),
            sourceIn: Array.from(new Set([...(filters?.sourceIn ?? []), 'manual_upload'])),
          }
        : filters

    if (input.mode === 'manual' && !enforcedFilters?.sourceIn?.includes('manual_upload')) {
      return { ok: false, error: 'Manual mode requires contacts imported via Upload (source=manual_upload)' }
    }
    const contactCount = await estimateContactCount(enforcedFilters)
    const contactIds = await selectContactIds(enforcedFilters)

    const domains = await query<any>(
      `SELECT id, domain, daily_limit, health_score, status, paused
       FROM domains
       WHERE client_id = $1
       ORDER BY id ASC`,
      [clientId],
    )

    const desiredDailyTarget = input.command.params?.dailyTarget ? Number(input.command.params.dailyTarget) : undefined
    const sendPlan = computeSendPlan({
      contactCount: contactIds.length, // actual execution limit
      desiredDailyTarget,
      domains: domains.rows,
      risk: riskLevel,
    })

    const patternStore = await loadPatternStore()
    const [replyLowPct, replyHighPct] = expectedReplyRateRange(patternStore)
    const expectedRepliesLow = Math.floor((sendPlan.projectedDailySend * replyLowPct) / 100)
    const expectedRepliesHigh = Math.ceil((sendPlan.projectedDailySend * replyHighPct) / 100)

    const name = String(input.command.params?.campaignNameNew ?? 'AI Campaign').trim()
    const dailyTarget = sendPlan.projectedDailySend > 0 ? sendPlan.projectedDailySend : clamp(desiredDailyTarget ?? 200, 10, 5000)
    // Structured outreach default: run over ~30 days even if capacity is high.
    const durationDays = Math.max(30, sendPlan.estimatedDurationDays || 0)

    const actions = [
      {
        id: `act_cmd_${Date.now()}_0`,
        title: `Create and launch: ${name}`,
        detail: `Creates campaign, selects up to ${contactIds.length} contacts, enqueues sequence steps, and starts sending safely.`,
        tool: 'createAndLaunchCampaign',
        args: {
          clientId,
          name,
          sequenceId,
          dailyTarget,
          durationDays,
          audienceMode: input.mode === 'manual' ? 'manual' : 'auto',
          contactIds,
        },
        requiresApproval: true as const,
      },
    ]

    const proposal = await createProposal({
      clientId,
      summary: `Command plan: ${name}`,
      proposedActions: actions,
    })

    await remember({
      clientId,
      scope: 'client',
      kind: 'copilot.command_plan_proposed',
      payload: {
        planId: proposal.id,
        action: 'create_campaign',
        sequenceId,
        contactCount: contactIds.length,
        projectedDailySend: sendPlan.projectedDailySend,
        riskLevel,
      },
    })

    return {
      ok: true,
      plan: ExecutionPlanSchema.parse({
        planId: proposal.id,
        command: input.command,
        systemStatus: ctx.systemStatus,
        riskLevel,
        contactCount: contactIds.length,
        projectedDailySend: sendPlan.projectedDailySend,
        estimatedDurationDays: sendPlan.estimatedDurationDays,
        domainUsage: sendPlan.domainUsage,
        expectedReplyRateRangePct: [replyLowPct, replyHighPct],
        expectedRepliesRange: [expectedRepliesLow, expectedRepliesHigh],
        actions,
      }),
    }
  } catch (error) {
    console.error('[PlanBuilder] buildExecutionPlan failed', error)
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
