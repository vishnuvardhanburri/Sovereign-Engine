import { NextRequest, NextResponse } from 'next/server'
import { buildSystemContext } from '@/lib/ai/system-context'
import { runDecisionEngine } from '@/lib/ai/decision-engine'
import { parseCommand } from '@/lib/ai/command-parser'
import { buildExecutionPlan } from '@/lib/ai/plan-builder'
import { getCampaignLiveStatus } from '@/lib/ai/live-status'

type ChatResponse =
  | {
      ok: true
      kind: 'answer'
      lines: string[]
    }
  | {
      ok: true
      kind: 'status'
      lines: string[]
      live?: any
    }
  | {
      ok: true
      kind: 'plan'
      lines: string[]
      plan: any
    }
  | { ok: false; error: string }

function shortLines(input: string[]): string[] {
  return input.map((s) => s.trim()).filter(Boolean).slice(0, 4)
}

function looksLikeStatus(text: string): boolean {
  const t = text.toLowerCase()
  return (
    /\b(status|health|performance|show performance|show stats|metrics|how many)\b/.test(t) ||
    /\b(sent|replies|reply|bounce|bounces|progress)\b/.test(t)
  )
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const text = String(body?.text ?? '').trim()
    const mode = body?.mode === 'manual' ? 'manual' : 'auto'
    if (!text) return NextResponse.json({ ok: false, error: 'Message is empty' }, { status: 400 })

    // Always ground on system context + decision engine.
    const context = await buildSystemContext()
    const decision = runDecisionEngine(context)

    // COMMAND: show plan card (no execution).
    const parsed = parseCommand(text)
    if (parsed.ok && parsed.command.action !== 'get_status') {
      const planned = await buildExecutionPlan({ command: parsed.command, mode })
      if (!planned.ok) return NextResponse.json({ ok: false, error: planned.error }, { status: 400 })

      const lines = shortLines([
        `State: ${context.systemStatus} (Risk ${context.riskLevel})`,
        `Plan: ${planned.plan.contactCount} contacts, ${planned.plan.projectedDailySend}/day, ${planned.plan.estimatedDurationDays}d`,
        `Expected: ${planned.plan.expectedReplyRateRangePct[0]}–${planned.plan.expectedReplyRateRangePct[1]}% replies (${planned.plan.expectedRepliesRange[0]}–${planned.plan.expectedRepliesRange[1]}/day)`,
        `Approve to start. No execution without approval.`,
      ])

      const resp: ChatResponse = { ok: true, kind: 'plan', lines, plan: planned.plan }
      return NextResponse.json(resp)
    }

    // STATUS: live metrics.
    if (looksLikeStatus(text) || (parsed.ok && parsed.command.action === 'get_status')) {
      const topCampaign = context.campaigns[0]
      const live = topCampaign?.id ? await getCampaignLiveStatus({ campaignId: topCampaign.id }) : null

      const sent = live?.sentCount ?? topCampaign?.sentCount ?? context.performance.last24h.sent
      const replies = live?.replyCount ?? topCampaign?.replyCount ?? context.performance.last24h.replies
      const bounces = live?.bounceCount ?? topCampaign?.bounceCount ?? context.performance.last24h.bounces

      const lines = shortLines([
        `State: ${context.systemStatus} (Risk ${context.riskLevel})`,
        `Numbers: sent ${sent}, replies ${replies}, bounces ${bounces}`,
        live ? `Progress: ${live.progressPct}% (queue ${live.queuedPending} pending, ${live.queuedRetry} retry)` : `Queue: ${context.queue.pending} pending, ${context.queue.retry} retry`,
        `Insight: ${decision.summary.headline}`,
      ])

      const resp: ChatResponse = { ok: true, kind: 'status', lines, ...(live ? { live } : {}) }
      return NextResponse.json(resp)
    }

    // QUESTION: concise answer with state + insight + suggested action.
    const topAction =
      decision.diagnoses.flatMap((d) => d.recommendedActions)[0] ??
      null

    const lines = shortLines([
      `State: ${context.systemStatus} (Risk ${context.riskLevel})`,
      `Insight: ${decision.summary.headline}`,
      topAction ? `Action: ${topAction.title}` : `Action: Monitor. No safe write recommended right now.`,
    ])

    const resp: ChatResponse = { ok: true, kind: 'answer', lines }
    return NextResponse.json(resp)
  } catch (error) {
    console.error('[API] copilot/chat failed', error)
    return NextResponse.json({ ok: false, error: 'Copilot chat failed' }, { status: 500 })
  }
}
