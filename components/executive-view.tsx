'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { ExecutiveSummary, InfrastructureAnalytics, InfrastructureHealth } from '@/lib/api'

function pct01(n: number): string {
  if (!Number.isFinite(n)) return '0%'
  return `${Math.round(n * 100)}%`
}

function pctDelta(n: number): string {
  if (!Number.isFinite(n)) return '0%'
  const sign = n >= 0 ? '+' : ''
  return `${sign}${Math.round(n * 100)}%`
}

function priorityTone(level: 'GREEN' | 'YELLOW' | 'RED'): string {
  if (level === 'GREEN') return 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30'
  if (level === 'YELLOW') return 'bg-amber-500/15 text-amber-200 border-amber-500/30'
  return 'bg-rose-500/15 text-rose-200 border-rose-500/30'
}

function statusFrom(health?: InfrastructureHealth, analytics?: InfrastructureAnalytics, exec?: ExecutiveSummary): {
  label: 'HEALTHY' | 'AT RISK' | 'DEGRADED'
  color: 'GREEN' | 'YELLOW' | 'RED'
  sentence: string
  actions: string[]
} {
  const paused = health?.status === 'paused'
  const healthy = health?.system.healthy ?? true
  const bounce24 = analytics?.metrics.health.avgBounceRate ?? 0
  const spam24 = analytics?.metrics.health.avgSpamRate ?? 0
  const bounceToday = exec?.today.bounceRate ?? 0

  if (paused) {
    return {
      label: 'AT RISK',
      color: 'YELLOW',
      sentence: 'System is paused. Resume when you are ready to send.',
      actions: ['Resume system', 'Start a campaign'],
    }
  }

  if (!healthy || bounce24 >= 5 || spam24 >= 3 || bounceToday >= 0.05) {
    return {
      label: 'DEGRADED',
      color: 'RED',
      sentence: 'Bounce risk elevated. Sending adjusted automatically to protect deliverability.',
      actions: ['Pause risky domains', 'Reduce send rate', 'Review suppression list'],
    }
  }

  if (bounce24 >= 3 || spam24 >= 1.5 || bounceToday >= 0.03) {
    return {
      label: 'AT RISK',
      color: 'YELLOW',
      sentence: 'System is running, but risk signals are elevated. Sending is being adjusted.',
      actions: ['Reduce send rate', 'Add a new domain', 'Check copy for spam risk'],
    }
  }

  return {
    label: 'HEALTHY',
    color: 'GREEN',
    sentence: 'System is operating normally. No risks detected.',
    actions: ['Start more campaigns', 'Add more prospects'],
  }
}

export function ExecutiveView(props: {
  health?: InfrastructureHealth
  analytics?: InfrastructureAnalytics
  executive?: ExecutiveSummary
}) {
  const summary = statusFrom(props.health, props.analytics, props.executive)
  const todaySends = props.executive?.today.sent ?? 0
  const replyRate = props.executive?.today.replyRate ?? 0
  const bounceRate = props.executive?.today.bounceRate ?? 0

  const impactConvos = props.executive?.businessImpact.estimatedConversationsToday ?? 0
  const replyTrend = props.executive?.businessImpact.replyTrendPct ?? 0

  const complianceLine = props.executive?.safety.complianceActive
    ? 'All compliance rules active'
    : 'Compliance status unknown'
  const blocked = props.executive?.safety.blockedContactsToday ?? 0
  const blockedLine = blocked === 0 ? 'No blocked contacts detected' : `${blocked} blocked contacts detected today`

  const recommendations = (props.analytics?.recommendations ?? []).slice(0, 2).map((r) => r.action)
  const recommended = recommendations.length > 0 ? recommendations : summary.actions.slice(0, 2)

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <Card className="xl:col-span-2 bg-white/5 backdrop-blur border-white/10">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base">System Summary</CardTitle>
            <Badge variant="outline" className={priorityTone(summary.color)}>
              {summary.label}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm text-muted-foreground">{summary.sentence}</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-muted-foreground">Today’s sends</div>
              <div className="mt-1 text-xl font-semibold">{todaySends.toLocaleString()}</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-muted-foreground">Reply rate</div>
              <div className="mt-1 text-xl font-semibold">{pct01(replyRate)}</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-muted-foreground">Bounce rate</div>
              <div className="mt-1 text-xl font-semibold">{pct01(bounceRate)}</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-muted-foreground">Business impact</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Estimated conversations today:{' '}
                <span className="text-foreground font-semibold">{impactConvos}</span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Reply trend: <span className="text-foreground font-semibold">{pctDelta(replyTrend)}</span> vs yesterday
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm">
            <div className="font-semibold">Safety status</div>
            <div className="mt-1 text-muted-foreground">{complianceLine}. {blockedLine}.</div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white/5 backdrop-blur border-white/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recommended Action</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {recommended.length === 0 ? (
            <div className="text-sm text-muted-foreground">System is initializing. Actions will appear shortly.</div>
          ) : (
            recommended.slice(0, 2).map((a, idx) => (
              <div key={idx} className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="text-sm font-semibold">{a}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Simple, safe next step. No micromanagement required.
                </div>
              </div>
            ))
          )}
          <div className="text-xs text-muted-foreground">
            Terms: “emails pending” means jobs waiting to be sent by the worker.
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

