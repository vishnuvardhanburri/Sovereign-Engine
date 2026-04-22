'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { AlertTriangle, Activity, Zap, Shield, RefreshCcw } from 'lucide-react'

type PlanResponse =
  | { ok: true; data: any }
  | { ok: false; error: string }

function toneForRisk(risk: string): string {
  if (risk === 'HIGH') return 'bg-rose-500/15 text-rose-200 border-rose-500/30'
  if (risk === 'MEDIUM') return 'bg-amber-500/15 text-amber-200 border-amber-500/30'
  return 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30'
}

export function CopilotControlPanel() {
  const [plan, setPlan] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [selectedAction, setSelectedAction] = useState<any | null>(null)

  const fetchPlan = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/copilot/plan', { method: 'GET' })
      const json: PlanResponse = await res.json()
      if (!res.ok || !json.ok) throw new Error((json as any).error || 'Failed to load copilot plan')
      setPlan((json as any).data)
    } catch (e) {
      console.error(e)
      toast.error('Failed to load Autonomous Copilot insight')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPlan()
  }, [])

  const ctx = plan?.context
  const decision = plan?.decision

  const primaryActions = useMemo(() => {
    const all = Array.isArray(plan?.actions) ? plan.actions : []
    return all.slice(0, 6)
  }, [plan])

  const executeAction = async () => {
    if (!plan?.proposalId || !selectedAction?.id) return
    setLoading(true)
    try {
      const res = await fetch('/api/copilot/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId: plan.proposalId,
          actionId: selectedAction.id,
          approve: true,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Execution failed')
      }
      toast.success('Action executed')
      setConfirmOpen(false)
      setSelectedAction(null)
      await fetchPlan()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to execute action')
    } finally {
      setLoading(false)
    }
  }

  if (loading && !plan) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    )
  }

  if (!plan || !ctx || !decision) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Autonomous Copilot</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            No system insight available yet.
          </p>
          <Button onClick={fetchPlan} disabled={loading} className="gap-2">
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card className="bg-white/5 backdrop-blur border-white/10">
        <CardHeader className="pb-3 flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 opacity-80" />
              System Insight
            </CardTitle>
            <div className="text-sm text-muted-foreground">
              {decision.summary.headline}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={toneForRisk(ctx.riskLevel)}>
              {ctx.systemStatus} · {ctx.riskLevel}
            </Badge>
            <Button variant="outline" size="sm" onClick={fetchPlan} disabled={loading} className="gap-2">
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="text-xs text-muted-foreground">Last 24h</div>
            <div className="mt-2 text-sm">
              sent <span className="text-foreground font-semibold">{ctx.performance.last24h.sent}</span> · reply{' '}
              <span className="text-foreground font-semibold">{Math.round(ctx.performance.last24h.replyRate * 10000) / 100}%</span> · bounce{' '}
              <span className="text-foreground font-semibold">{Math.round(ctx.performance.last24h.bounceRate * 10000) / 100}%</span>
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="text-xs text-muted-foreground">Queue</div>
            <div className="mt-2 text-sm">
              pending <span className="text-foreground font-semibold">{ctx.queue.pending}</span> · retry{' '}
              <span className="text-foreground font-semibold">{ctx.queue.retry}</span> · lag{' '}
              <span className="text-foreground font-semibold">{ctx.queue.avgScheduleLagSeconds}s</span>
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="text-xs text-muted-foreground">Infra Risk</div>
            <div className="mt-2 text-sm">
              overall <span className="text-foreground font-semibold">{Math.round(ctx.infraRisk.overall * 100)}%</span> · signals{' '}
              <span className="text-foreground font-semibold">{ctx.infraRisk.signals.length}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white/5 backdrop-blur border-white/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4 opacity-80" />
            AI Recommendation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {decision.diagnoses.length === 0 ? (
            <div className="text-sm text-muted-foreground">No anomalies detected. Keep running.</div>
          ) : (
            decision.diagnoses.slice(0, 3).map((d: any, idx: number) => (
              <div key={idx} className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium text-sm">{d.issue}</div>
                  <Badge variant="outline">{Math.round((d.confidence ?? 0) * 100)}%</Badge>
                </div>
                <div className="text-sm text-muted-foreground">{d.cause}</div>
                {Array.isArray(d.evidence) && d.evidence.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    Evidence: {d.evidence.slice(0, 4).join(' · ')}
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="bg-white/5 backdrop-blur border-white/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 opacity-80" />
            Quick Actions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {primaryActions.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No safe actions proposed right now.
            </div>
          ) : (
            primaryActions.map((a: any) => (
              <div
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 p-3"
              >
                <div className="space-y-1">
                  <div className="text-sm font-medium">{a.title}</div>
                  <div className="text-xs text-muted-foreground">{a.detail}</div>
                </div>
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => {
                    setSelectedAction(a)
                    setConfirmOpen(true)
                  }}
                >
                  <AlertTriangle className="h-4 w-4" />
                  Review
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirm action</DialogTitle>
            <DialogDescription>
              Writes are never executed automatically. Confirm to apply the action.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border p-3 bg-muted/20">
              <div className="text-sm font-medium">{selectedAction?.title ?? 'Action'}</div>
              <div className="text-xs text-muted-foreground mt-1">{selectedAction?.detail ?? ''}</div>
              <div className="text-xs text-muted-foreground mt-2">
                Tool: <span className="text-foreground">{selectedAction?.tool}</span>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={loading}>
                Cancel
              </Button>
              <Button onClick={executeAction} disabled={loading} className="gap-2">
                <AlertTriangle className="h-4 w-4" />
                Confirm and execute
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

