'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { InfrastructureHealth, OperatorAction } from '@/lib/api'

function tone(severity: string): string {
  const s = severity.toLowerCase()
  if (s === 'critical' || s === 'high') return 'bg-rose-500/15 text-rose-200 border-rose-500/30'
  if (s === 'warning' || s === 'medium') return 'bg-amber-500/15 text-amber-200 border-amber-500/30'
  return 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30'
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function SelfHealActions(props: {
  health?: InfrastructureHealth
  actions?: OperatorAction[]
}) {
  const fromAlerts = (props.health?.alerts?.critical ?? []).slice(0, 4).map((raw, idx) => {
    const item = raw as Record<string, unknown>
    return {
      id: `crit_${idx}`,
      at: typeof item.timestamp === 'string' ? item.timestamp : props.health?.timestamp ?? new Date().toISOString(),
      title: typeof item.title === 'string' ? item.title : 'Critical alert',
      detail: typeof item.message === 'string' ? item.message : '',
      severity: typeof item.severity === 'string' ? item.severity : 'critical',
    }
  })

  const fromActions = (props.actions ?? [])
    .filter((a) => a.action_type.toLowerCase().includes('heal') || a.action_type.toLowerCase().includes('retry') || a.action_type.toLowerCase().includes('recovery'))
    .slice(0, 4)
    .map((a) => ({
      id: `act_${a.id}`,
      at: a.created_at,
      title: a.summary,
      detail: '',
      severity: 'info',
    }))

  const list = (fromActions.length > 0 ? fromActions : fromAlerts)

  return (
    <Card className="bg-white/5 backdrop-blur border-white/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Self-Healing Actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {list.length === 0 ? (
          <div className="text-sm text-muted-foreground">No self-heal actions recently. System is stable.</div>
        ) : (
          list.map((a) => (
            <div key={a.id} className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{a.title}</div>
                  {a.detail ? <div className="mt-1 text-xs text-muted-foreground truncate">{a.detail}</div> : null}
                  <div className="mt-2 text-xs text-muted-foreground">at {fmtTime(a.at)}</div>
                </div>
                <Badge variant="outline" className={tone(a.severity)}>
                  {String(a.severity).toUpperCase()}
                </Badge>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

