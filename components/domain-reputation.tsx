'use client'

import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import type { InfrastructureAnalytics } from '@/lib/api'

function badgeForHealth(health: string, paused: boolean): { label: string; className: string } {
  if (paused) return { label: 'PAUSED', className: 'bg-amber-500/15 text-amber-200 border-amber-500/30' }
  const h = health.toLowerCase()
  if (h === 'excellent' || h === 'healthy') return { label: health.toUpperCase(), className: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30' }
  if (h === 'warning' || h === 'degraded') return { label: health.toUpperCase(), className: 'bg-amber-500/15 text-amber-200 border-amber-500/30' }
  return { label: health.toUpperCase(), className: 'bg-rose-500/15 text-rose-200 border-rose-500/30' }
}

export function DomainReputation(props: { analytics?: InfrastructureAnalytics; loading?: boolean }) {
  const domains = props.analytics?.domains ?? []

  return (
    <Card className="bg-white/5 backdrop-blur border-white/10">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Domain Intelligence</CardTitle>
          <Link href="/domains" className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
            Manage domains
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {domains.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No domains yet. Add a sending domain to unlock reputation scoring and rotation.
          </div>
        ) : (
          <div className="space-y-2">
            {domains.slice(0, 8).map((d) => {
              const badge = badgeForHealth(d.health, d.paused)
              const usagePct = d.sent24h && props.analytics?.metrics.capacity.total
                ? Math.min(100, Math.round((d.sent24h / Math.max(1, props.analytics.metrics.capacity.total)) * 100))
                : 0
              return (
                <div key={d.id} className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{d.domain}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        24h sent: <span className="text-foreground">{d.sent24h}</span> · bounce: <span className="text-foreground">{d.bounceRate}%</span> · spam: <span className="text-foreground">{d.spamRate}%</span>
                      </div>
                    </div>
                    <Badge variant="outline" className={badge.className}>
                      {badge.label}
                    </Badge>
                  </div>
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Usage pressure</span>
                      <span className="text-foreground">{usagePct}%</span>
                    </div>
                    <div className="mt-2">
                      <Progress value={usagePct} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

