'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useViewMode } from '@/components/ai/view-mode'

type ApiOk<T> = { ok: true; data: T }
type ApiErr = { ok: false; error: string; details?: string }

type ExecutionPlan = {
  planId: string
  systemStatus: string
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'
  contactCount: number
  projectedDailySend: number
  estimatedDurationDays: number
  domainUsage: Array<{ domainId: number; domain: string; dailyLimit: number; projectedSend: number; healthScore: number }>
  expectedReplyRateRangePct: [number, number]
  expectedRepliesRange: [number, number]
  actions: Array<{ id: string; title: string; detail: string; tool: string; args: Record<string, any>; requiresApproval: true }>
}

type LiveStatus = {
  campaignId: number
  status: string
  contactCount: number
  sentCount: number
  replyCount: number
  bounceCount: number
  replyRatePct: number
  bounceRatePct: number
  progressPct: number
  queuedPending: number
  queuedRetry: number
  queuedProcessing: number
  queuedCompleted: number
  queuedFailed: number
  updatedAt: string
}

function riskBadge(risk: ExecutionPlan['riskLevel']) {
  if (risk === 'HIGH') return 'destructive'
  if (risk === 'MEDIUM') return 'secondary'
  return 'outline'
}

export function CommandCenter() {
  const { viewMode } = useViewMode()
  const readOnly = viewMode === 'client'
  const [mode, setMode] = useState<'auto' | 'manual'>('auto')

  const [text, setText] = useState('')
  const [plan, setPlan] = useState<ExecutionPlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [executing, setExecuting] = useState(false)
  const [live, setLive] = useState<LiveStatus | null>(null)

  const primaryAction = plan?.actions?.[0] ?? null

  const example = useMemo(
    () => `Create campaign "Founders Q2" for founders title:CEO company:seed daily:200 sequence:1 limit:500`,
    [],
  )

  async function buildPlan() {
    setError(null)
    setPlan(null)
    setLive(null)

    const res = await fetch('/api/copilot/command/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, mode }),
    })
    const json = (await res.json()) as ApiOk<ExecutionPlan> | ApiErr
    if (!json.ok) throw new Error(json.error)
    setPlan(json.data)
  }

  async function executePlan() {
    if (!plan || !primaryAction) return
    setError(null)
    setExecuting(true)
    try {
      const res = await fetch('/api/copilot/command/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planId: plan.planId, actionId: primaryAction.id, approve: true }),
      })
      const json = (await res.json()) as any
      if (!json.ok) throw new Error(json.error ?? 'Execution failed')

      // If the tool created a campaign, start live polling.
      const campaignId = Number(json.result?.data?.campaignId ?? json.result?.campaignId ?? json.result?.data?.id ?? null)
      if (Number.isFinite(campaignId) && campaignId > 0) {
        setLive({ ...(live as any), campaignId } as any)
      }
    } finally {
      setExecuting(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    const campaignId = live?.campaignId
    if (!campaignId) return

    const tick = async () => {
      try {
        const res = await fetch(`/api/copilot/command/live-status?campaignId=${campaignId}`, { cache: 'no-store' })
        const json = (await res.json()) as ApiOk<LiveStatus> | ApiErr
        if (!json.ok) return
        if (!cancelled) setLive(json.data)
      } catch {
        // ignore
      }
    }

    tick()
    const id = window.setInterval(tick, 8000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [live?.campaignId])

  return (
    <Card className="p-5 bg-card/40 backdrop-blur border-border/60">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Command Center</h2>
            <Badge variant="outline">Plan → Approve → Track</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Type an outbound instruction. We will generate a concrete execution plan with numbers, require approval, then track results live.
          </p>
        </div>
        <div className="text-xs text-muted-foreground">
          {readOnly ? <Badge variant="secondary">Client View (Read-only)</Badge> : <Badge variant="outline">Operator Mode</Badge>}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-sm">
        <Badge variant="outline">Outbound Mode</Badge>
        <div className="flex gap-2">
          <Button
            variant={mode === 'auto' ? 'default' : 'secondary'}
            size="sm"
            onClick={() => setMode('auto')}
            disabled={isPending || executing}
          >
            Auto
          </Button>
          <Button
            variant={mode === 'manual' ? 'default' : 'secondary'}
            size="sm"
            onClick={() => setMode('manual')}
            disabled={isPending || executing}
          >
            Manual (Uploaded)
          </Button>
        </div>
      </div>

      <div className="mt-4 flex flex-col md:flex-row gap-3">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={example}
          className="flex-1"
          disabled={isPending || executing}
        />
        <Button
          onClick={() =>
            startTransition(async () => {
              try {
                await buildPlan()
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              }
            })
          }
          disabled={!text.trim() || isPending || executing}
        >
          Generate Plan
        </Button>
      </div>

      {error && <div className="mt-3 text-sm text-red-400">{error}</div>}

      {plan && (
        <div className="mt-5 grid grid-cols-1 xl:grid-cols-12 gap-4">
          <div className="xl:col-span-7 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={riskBadge(plan.riskLevel) as any}>Risk: {plan.riskLevel}</Badge>
              <Badge variant="outline">System: {plan.systemStatus}</Badge>
              <Badge variant="outline">Contacts: {plan.contactCount}</Badge>
              <Badge variant="outline">Daily send: {plan.projectedDailySend}</Badge>
              <Badge variant="outline">Duration: {plan.estimatedDurationDays}d</Badge>
            </div>

            <div className="text-sm text-muted-foreground">
              Expected reply rate: {plan.expectedReplyRateRangePct[0]}–{plan.expectedReplyRateRangePct[1]}% (≈ {plan.expectedRepliesRange[0]}–
              {plan.expectedRepliesRange[1]} replies/day at projected volume)
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Domain usage (projected/day)</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {plan.domainUsage.slice(0, 6).map((d) => (
                  <div key={d.domainId} className="rounded-md border border-border/60 bg-background/40 px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium">{d.domain}</div>
                      <div className="text-muted-foreground">{d.projectedSend}/{d.dailyLimit}</div>
                    </div>
                    <div className="text-xs text-muted-foreground">Health {Math.round(d.healthScore)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="xl:col-span-5 space-y-3">
            <div className="rounded-md border border-border/60 bg-background/40 p-3">
              <div className="text-sm font-medium">Recommended action</div>
              {primaryAction ? (
                <div className="mt-2 space-y-2">
                  <div className="text-sm">{primaryAction.title}</div>
                  <div className="text-xs text-muted-foreground">{primaryAction.detail}</div>
                  <Button
                    variant="default"
                    className="w-full"
                    onClick={async () => {
                      if (readOnly) return
                      if (!window.confirm('Execute this plan now? This will perform real writes in your local DB.')) return
                      try {
                        await executePlan()
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e))
                      }
                    }}
                    disabled={readOnly || executing}
                  >
                    {executing ? 'Executing…' : 'Approve & Execute'}
                  </Button>
                </div>
              ) : (
                <div className="mt-2 text-sm text-muted-foreground">No write action required.</div>
              )}
            </div>

            {live && (
              <div className="rounded-md border border-border/60 bg-background/40 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">Live tracking</div>
                  <Badge variant="outline">Campaign #{live.campaignId}</Badge>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-md bg-black/20 p-2">
                    <div className="text-xs text-muted-foreground">Sent</div>
                    <div className="font-semibold">{live.sentCount}</div>
                  </div>
                  <div className="rounded-md bg-black/20 p-2">
                    <div className="text-xs text-muted-foreground">Replies</div>
                    <div className="font-semibold">
                      {live.replyCount} ({live.replyRatePct}%)
                    </div>
                  </div>
                  <div className="rounded-md bg-black/20 p-2">
                    <div className="text-xs text-muted-foreground">Bounces</div>
                    <div className="font-semibold">
                      {live.bounceCount} ({live.bounceRatePct}%)
                    </div>
                  </div>
                  <div className="rounded-md bg-black/20 p-2">
                    <div className="text-xs text-muted-foreground">Progress</div>
                    <div className="font-semibold">{live.progressPct}%</div>
                  </div>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Queue: {live.queuedPending} pending, {live.queuedRetry} retry, {live.queuedCompleted} completed, {live.queuedFailed} failed
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}
