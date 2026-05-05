'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react'
import type { InfrastructureAnalytics, InfrastructureHealth } from '@/lib/api'

function tone(value: number, good: number, warn: number): 'good' | 'warn' | 'bad' {
  if (value >= good) return 'good'
  if (value >= warn) return 'warn'
  return 'bad'
}

function badgeClass(level: 'good' | 'warn' | 'bad'): string {
  if (level === 'good') return 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30'
  if (level === 'warn') return 'bg-amber-500/15 text-amber-200 border-amber-500/30'
  return 'bg-rose-500/15 text-rose-200 border-rose-500/30'
}

export function SystemHealth(props: {
  health?: InfrastructureHealth
  analytics?: InfrastructureAnalytics
  loading?: boolean
}) {
  const status = props.health?.status ?? 'running'
  const healthy = props.health?.system.healthy ?? true
  const utilization = props.analytics?.metrics.capacity.utilization ?? props.health?.system.capacityUtilization ?? 0
  const bounce = props.analytics?.metrics.health.avgBounceRate ?? 0
  const spam = props.analytics?.metrics.health.avgSpamRate ?? 0

  const bounceLevel = tone(100 - bounce, 98, 95) // bounce is in percent points; invert to keep "higher is better"
  const spamLevel = tone(100 - spam, 99, 97)
  const utilLevel = tone(100 - utilization, 45, 20) // higher utilization increases risk
  const overall: 'good' | 'warn' | 'bad' =
    status === 'paused' ? 'warn' : healthy && bounce < 3 && spam < 1.5 ? 'good' : bounce >= 5 || spam >= 3 || !healthy ? 'bad' : 'warn'

  return (
    <Card className="bg-white/5 backdrop-blur border-white/10">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">System Health</CardTitle>
          <Badge variant="outline" className={badgeClass(overall)}>
            {overall === 'good' ? (
              <span className="inline-flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5" /> Stable
              </span>
            ) : overall === 'warn' ? (
              <span className="inline-flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5" /> Watch
              </span>
            ) : (
              <span className="inline-flex items-center gap-2">
                <ShieldAlert className="h-3.5 w-3.5" /> Risk
              </span>
            )}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="text-xs text-muted-foreground">Throttling Level</div>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <div className="text-xl font-semibold">{utilization}%</div>
              <Badge variant="outline" className={badgeClass(utilLevel)}>
                {utilLevel === 'good' ? 'Low' : utilLevel === 'warn' ? 'Medium' : 'High'}
              </Badge>
            </div>
            <div className="mt-2">
              <Progress value={Math.min(100, utilization)} />
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="text-xs text-muted-foreground">Spam Risk</div>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <div className="text-xl font-semibold">{spam.toFixed(2)}%</div>
              <Badge variant="outline" className={badgeClass(spamLevel)}>
                {spamLevel === 'good' ? 'Clean' : spamLevel === 'warn' ? 'Caution' : 'Danger'}
              </Badge>
            </div>
            <div className="mt-2">
              <Progress value={Math.min(100, Math.max(0, spam * 15))} />
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">Bounce Rate (24h average)</div>
            <Badge variant="outline" className={badgeClass(bounceLevel)}>
              {bounce.toFixed(2)}%
            </Badge>
          </div>
          <div className="mt-2">
            <Progress value={Math.min(100, Math.max(0, bounce * 15))} />
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            System state: <span className="text-foreground">{status.toUpperCase()}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

