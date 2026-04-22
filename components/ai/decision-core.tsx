'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useInfrastructureAnalytics } from '@/lib/hooks'
import { BrainCircuit, Sparkles } from 'lucide-react'

function impactLabel(estimatedImpact: string): string {
  const trimmed = String(estimatedImpact ?? '').trim()
  if (!trimmed) return 'Impact: unknown'
  return trimmed.length > 44 ? `${trimmed.slice(0, 44)}…` : trimmed
}

function priorityTone(priority: string): string {
  const p = String(priority ?? '').toLowerCase()
  if (p === 'high' || p === 'critical') return 'border-rose-500/30 bg-rose-500/10 text-rose-200'
  if (p === 'medium') return 'border-amber-500/30 bg-amber-500/10 text-amber-200'
  return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
}

export function DecisionCorePanel() {
  const { data: analytics } = useInfrastructureAnalytics()
  const recs = (analytics?.recommendations ?? []).slice(0, 2)

  return (
    <Card className="bg-white/5 backdrop-blur border-white/10 h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BrainCircuit className="h-4 w-4 opacity-80" />
          AI Decision Core
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {recs.length === 0 ? (
          <div className="rounded-lg border border-white/10 bg-black/20 p-4">
            <div className="text-sm font-medium">No high-priority recommendations</div>
            <div className="text-sm text-muted-foreground mt-1">
              The system is not detecting urgent infrastructure issues from live telemetry.
            </div>
          </div>
        ) : (
          recs.map((r) => (
            <div key={r.id} className="rounded-lg border border-white/10 bg-black/20 p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-sm font-semibold flex items-center gap-2">
                    <Sparkles className="h-4 w-4 opacity-80" />
                    {r.title}
                  </div>
                  <div className="text-sm text-muted-foreground">{r.description}</div>
                </div>
                <Badge variant="outline" className={priorityTone(r.priority)}>
                  {String(r.priority).toUpperCase()}
                </Badge>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                <div className="rounded-md border border-white/10 bg-black/10 p-2">
                  <div className="text-[11px] text-muted-foreground">Reason</div>
                  <div className="text-xs">{r.category}</div>
                </div>
                <div className="rounded-md border border-white/10 bg-black/10 p-2">
                  <div className="text-[11px] text-muted-foreground">Expected impact</div>
                  <div className="text-xs">{impactLabel(r.estimatedImpact)}</div>
                </div>
                <div className="rounded-md border border-white/10 bg-black/10 p-2">
                  <div className="text-[11px] text-muted-foreground">Confidence</div>
                  <div className="text-xs">{r.confidence}%</div>
                </div>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

