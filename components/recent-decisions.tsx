'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { InfrastructureAnalytics, OperatorAction } from '@/lib/api'

function decisionTone(priority: string): string {
  const p = priority.toLowerCase()
  if (p === 'high' || p === 'critical') return 'bg-rose-500/15 text-rose-200 border-rose-500/30'
  if (p === 'medium') return 'bg-amber-500/15 text-amber-200 border-amber-500/30'
  return 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30'
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function RecentDecisions(props: {
  analytics?: InfrastructureAnalytics
  actions?: OperatorAction[]
}) {
  const decisionsFromRecommendations = (props.analytics?.recommendations ?? []).slice(0, 5).map((r) => ({
    id: `rec_${r.id}`,
    at: props.analytics?.timestamp ?? new Date().toISOString(),
    title: r.title,
    detail: r.action,
    badge: r.priority.toUpperCase(),
    badgeClass: decisionTone(r.priority),
  }))

  const decisionsFromActions = (props.actions ?? [])
    .filter((a) => a.action_type.toLowerCase().includes('decision') || a.action_type.toLowerCase().includes('optimiz'))
    .slice(0, 5)
    .map((a) => ({
      id: `act_${a.id}`,
      at: a.created_at,
      title: a.summary,
      detail: '',
      badge: a.action_type.toUpperCase(),
      badgeClass: 'bg-white/5 text-slate-200 border-white/10',
    }))

  const list = (decisionsFromActions.length > 0 ? decisionsFromActions : decisionsFromRecommendations)

  return (
    <Card className="bg-white/5 backdrop-blur border-white/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Recent Decisions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {list.length === 0 ? (
          <div className="text-sm text-muted-foreground">System initializing. Decisions will appear as metrics arrive.</div>
        ) : (
          list.map((d) => (
            <div key={d.id} className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{d.title}</div>
                  {d.detail ? <div className="mt-1 text-xs text-muted-foreground truncate">{d.detail}</div> : null}
                  <div className="mt-2 text-xs text-muted-foreground">at {fmtTime(d.at)}</div>
                </div>
                <Badge variant="outline" className={d.badgeClass}>
                  {d.badge}
                </Badge>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

