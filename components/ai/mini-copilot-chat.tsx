'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useViewMode } from '@/components/ai/view-mode'

type ChatMsg = { id: string; role: 'user' | 'assistant'; text: string; kind?: 'answer' | 'status' | 'plan'; plan?: any }

type ChatApi =
  | { ok: true; kind: 'answer' | 'status'; lines: string[]; live?: any }
  | { ok: true; kind: 'plan'; lines: string[]; plan: any }
  | { ok: false; error: string }

function uid() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function lastN<T>(arr: T[], n: number): T[] {
  return arr.slice(Math.max(0, arr.length - n))
}

export function MiniCopilotChat() {
  const { viewMode, demoMode } = useViewMode()
  const readOnly = viewMode === 'client'

  const [open, setOpen] = useState(true)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msgs, setMsgs] = useState<ChatMsg[]>(() => [
    {
      id: uid(),
      role: 'assistant',
      kind: 'answer',
      text: `State: loading\nInsight: ask a question or type a command\nAction: I will generate a plan with approval`,
    },
  ])

  const visible = useMemo(() => lastN(msgs, 5), [msgs])
  const lastPlan = useMemo(() => [...visible].reverse().find((m) => m.kind === 'plan' && m.plan)?.plan ?? null, [visible])

  async function send() {
    const prompt = text.trim()
    if (!prompt || busy) return
    setText('')
    setBusy(true)
    setMsgs((m) => [...m, { id: uid(), role: 'user', text: prompt }])
    try {
      const res = await fetch('/api/copilot/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: prompt }),
      })
      const json = (await res.json()) as ChatApi
      if (!json.ok) throw new Error(json.error)

      const lines = Array.isArray(json.lines) ? json.lines : []
      const assistantText = lines.join('\n')
      setMsgs((m) => [
        ...m,
        {
          id: uid(),
          role: 'assistant',
          kind: json.kind,
          text: assistantText,
          ...(json.kind === 'plan' ? { plan: json.plan } : {}),
        },
      ])
    } catch (e) {
      setMsgs((m) => [
        ...m,
        { id: uid(), role: 'assistant', kind: 'answer', text: `State: unknown\nInsight: ${(e as any)?.message ?? 'Request failed'}\nAction: Check server logs` },
      ])
    } finally {
      setBusy(false)
    }
  }

  async function approveAndStart() {
    if (!lastPlan) return
    const action = Array.isArray(lastPlan.actions) ? lastPlan.actions[0] : null
    if (!action) return
    if (readOnly) return
    if (!window.confirm('Approve & Start? This will execute real writes in your local DB.')) return

    setBusy(true)
    try {
      const res = await fetch('/api/copilot/command/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planId: lastPlan.planId, actionId: action.id, approve: true }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? 'Execution failed')
      setMsgs((m) => [
        ...m,
        {
          id: uid(),
          role: 'assistant',
          kind: 'status',
          text: `State: approved\nNumbers: action executed\nInsight: live tracking is updating in panels\nAction: Watch progress + replies`,
        },
      ])
    } catch (e) {
      setMsgs((m) => [
        ...m,
        { id: uid(), role: 'assistant', kind: 'answer', text: `State: blocked\nInsight: ${(e as any)?.message ?? 'Execution failed'}\nAction: Try again or adjust plan` },
      ])
    } finally {
      setBusy(false)
    }
  }

  async function simulate() {
    if (!demoMode) {
      setMsgs((m) => [
        ...m,
        { id: uid(), role: 'assistant', kind: 'answer', text: `State: simulation\nInsight: Demo Mode is OFF\nAction: Turn on Demo Mode to simulate events` },
      ])
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/demo/simulate-day', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? 'Simulation failed')
      setMsgs((m) => [
        ...m,
        { id: uid(), role: 'assistant', kind: 'status', text: `State: demo simulated\nNumbers: 1 day advanced\nInsight: panels refreshed automatically\nAction: Review impact + recommendations` },
      ])
    } catch (e) {
      setMsgs((m) => [
        ...m,
        { id: uid(), role: 'assistant', kind: 'answer', text: `State: simulation failed\nInsight: ${(e as any)?.message ?? 'Failed'}\nAction: Retry` },
      ])
    } finally {
      setBusy(false)
    }
  }

  // Keep the first assistant message honest once context is live (without being chatty).
  useEffect(() => {
    // no-op: the assistant text is always grounded by /api/copilot/chat on next send.
  }, [])

  return (
    <div className="fixed right-4 bottom-4 z-50 w-[360px] max-w-[calc(100vw-2rem)]">
      <Card className="border-border/60 bg-card/40 backdrop-blur shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_18px_45px_rgba(0,0,0,0.55)]">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/60">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold">Xavira AI Assistant</div>
            <Badge variant="outline">Minimal</Badge>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide' : 'Show'}
          </Button>
        </div>

        {open && (
          <div className="p-3 space-y-3">
            <div className="space-y-2 max-h-[240px] overflow-auto pr-1">
              {visible.map((m) => (
                <div key={m.id} className={m.role === 'user' ? 'text-right' : 'text-left'}>
                  <div
                    className={[
                      'inline-block whitespace-pre-line rounded-md px-2.5 py-2 text-sm border',
                      m.role === 'user'
                        ? 'bg-sidebar-primary/20 border-sidebar-primary/30'
                        : 'bg-background/40 border-border/60',
                    ].join(' ')}
                  >
                    {m.text}
                  </div>
                </div>
              ))}
            </div>

            {lastPlan && (
              <div className="rounded-md border border-border/60 bg-background/40 p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold">Plan Card</div>
                  <Badge variant="outline">Risk {lastPlan.riskLevel}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {lastPlan.contactCount} contacts, {lastPlan.projectedDailySend}/day, {lastPlan.estimatedDurationDays}d, expected {lastPlan.expectedRepliesRange?.[0]}–{lastPlan.expectedRepliesRange?.[1]} replies/day
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" className="flex-1" onClick={simulate} disabled={busy}>
                    Simulate
                  </Button>
                  <Button size="sm" className="flex-1" onClick={approveAndStart} disabled={busy || readOnly}>
                    Approve & Start
                  </Button>
                </div>
                {readOnly && <div className="text-[11px] text-muted-foreground">Client View is read-only.</div>}
              </div>
            )}

            <div className="flex gap-2">
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder='Try: "Why are replies low?"'
                onKeyDown={(e) => {
                  if (e.key === 'Enter') send()
                }}
                disabled={busy}
              />
              <Button onClick={send} disabled={busy || !text.trim()}>
                Send
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

