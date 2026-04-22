'use client'

import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  useCampaigns,
  useChartData,
  useDashboardStats,
  useExecutiveSummary,
  useExecutiveForecast,
  useInfrastructureAnalytics,
  useInfrastructureControl,
  useInfrastructureHealth,
  useOperatorActions,
  usePatterns,
  useQueueStats,
  useRecentEvents,
} from '@/lib/hooks'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AgentFeed } from '@/components/agent-feed'
import { DomainReputation } from '@/components/domain-reputation'
import { PatternLeaderboard } from '@/components/pattern-leaderboard'
import { SystemHealth } from '@/components/system-health'
import { RecentDecisions } from '@/components/recent-decisions'
import { SelfHealActions } from '@/components/self-heal-actions'
import { AnimatedNumber } from '@/components/animated-number'
import { ExecutiveView } from '@/components/executive-view'
import { ForecastPanel } from '@/components/forecast-panel'
import { ArrowRight, PauseCircle, PlayCircle, RefreshCcw, ShieldAlert, Zap } from 'lucide-react'

const DashboardSentChart = dynamic(
  () => import('@/components/dashboard-sent-chart').then((m) => m.DashboardSentChart),
  { ssr: false, loading: () => <Skeleton className="h-72" /> }
)

function statusTone(status: 'ACTIVE' | 'DEGRADED' | 'PAUSED'): string {
  if (status === 'ACTIVE') return 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30'
  if (status === 'PAUSED') return 'bg-amber-500/15 text-amber-200 border-amber-500/30'
  return 'bg-rose-500/15 text-rose-200 border-rose-500/30'
}

function riskTone(level: 'LOW' | 'MEDIUM' | 'HIGH'): string {
  if (level === 'LOW') return 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30'
  if (level === 'MEDIUM') return 'bg-amber-500/15 text-amber-200 border-amber-500/30'
  return 'bg-rose-500/15 text-rose-200 border-rose-500/30'
}

export default function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useDashboardStats()
  const { data: chartData, isLoading: chartLoading } = useChartData()
  const { data: queue } = useQueueStats()
  const { data: health } = useInfrastructureHealth()
  const { data: analytics } = useInfrastructureAnalytics()
  const { data: executive } = useExecutiveSummary()
  const { data: forecast } = useExecutiveForecast(5)
  const { data: patterns } = usePatterns()
  const { data: events } = useRecentEvents(70)
  const { data: campaigns } = useCampaigns()
  const control = useInfrastructureControl()
  const { data: operatorActions } = useOperatorActions(60)

  const [campaignToStart, setCampaignToStart] = useState<string>('')
  const [startOpen, setStartOpen] = useState(false)

  const systemStatus: 'ACTIVE' | 'DEGRADED' | 'PAUSED' = useMemo(() => {
    if (health?.status === 'paused') return 'PAUSED'
    if (health && !health.system.healthy) return 'DEGRADED'
    return 'ACTIVE'
  }, [health])

  const riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = useMemo(() => {
    const bounce = analytics?.metrics.health.avgBounceRate ?? 0
    const spam = analytics?.metrics.health.avgSpamRate ?? 0
    const util = analytics?.metrics.capacity.utilization ?? health?.system.capacityUtilization ?? 0
    if (systemStatus === 'PAUSED') return 'MEDIUM'
    if (bounce >= 5 || spam >= 3 || util >= 92 || (health && !health.system.healthy)) return 'HIGH'
    if (bounce >= 3 || spam >= 1.5 || util >= 80) return 'MEDIUM'
    return 'LOW'
  }, [analytics, health, systemStatus])

  const activeDomains = analytics?.metrics.healthyDomains ?? 0
  const queueSize = queue?.total ?? 0

  const campaignRows = useMemo(() => {
    const rows = campaigns ?? []
    const avgOpen = rows.length > 0 ? rows.reduce((s, c) => s + c.openRate, 0) / rows.length : 0
    return rows
      .slice()
      .sort((a, b) => (b.replies - a.replies) || (b.sent - a.sent))
      .slice(0, 6)
      .map((c) => ({
        ...c,
        trend: c.openRate >= avgOpen ? 'up' : 'down',
      }))
  }, [campaigns])

  async function startSelectedCampaign(): Promise<void> {
    if (!campaignToStart) return
    try {
      const res = await fetch('/api/campaign/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: campaignToStart }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error || 'Failed to start campaign')
      }
      const body = (await res.json()) as { queued_jobs?: number }
      toast.success(`Campaign started. Jobs queued: ${body.queued_jobs ?? 0}`)
      setStartOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start campaign')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">Control Tower</h1>
          <p className="text-muted-foreground">Live system state, safe execution, and instant controls.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
            </span>
            <span className="text-muted-foreground">System Running</span>
          </div>
          <Badge variant="outline" className="bg-white/5 text-slate-200 border-white/10">
            Autonomous Mode: ACTIVE
          </Badge>
          <Badge variant="outline" className={statusTone(systemStatus)}>
            System: {systemStatus}
          </Badge>
          <Badge variant="outline" className={riskTone(riskLevel)}>
            Risk: {riskLevel}
          </Badge>
          <div className="text-xs text-muted-foreground">
            Last updated:{' '}
            <span className="text-foreground">
              {health?.timestamp ? new Date(health.timestamp).toLocaleTimeString() : '...'}
            </span>
          </div>
        </div>
      </div>

      <ExecutiveView health={health} analytics={analytics} executive={executive} />
      <ForecastPanel forecast={forecast} />

      {/* Global Status Bar */}
      <Card className="bg-white/5 backdrop-blur border-white/10">
        <CardContent className="py-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-muted-foreground">System State</div>
              <div className="mt-1 text-sm font-semibold">{systemStatus}</div>
              <div className="mt-1 text-xs text-muted-foreground">Autonomous mode is enforcing safety rules.</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-muted-foreground">Emails Sent Today</div>
              <div className="mt-1 text-2xl font-semibold">
                {statsLoading ? '...' : <AnimatedNumber value={stats?.emailsSentToday ?? 0} />}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                replies: <span className="text-foreground">{stats?.replies ?? 0}</span>
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-muted-foreground">Emails in progress</div>
              <div className="mt-1 text-2xl font-semibold">
                <AnimatedNumber value={queueSize} />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                ready: <span className="text-foreground">{queue?.ready ?? 0}</span> · scheduled:{' '}
                <span className="text-foreground">{queue?.scheduled ?? 0}</span>
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-muted-foreground">Active Domains</div>
              <div className="mt-1 text-2xl font-semibold">
                <AnimatedNumber value={activeDomains} durationMs={450} />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                utilization: <span className="text-foreground">{analytics?.metrics.capacity.utilization ?? 0}%</span>
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-muted-foreground">Open Rate</div>
              <div className="mt-1 text-2xl font-semibold">{stats ? `${stats.openRate}%` : '0%'}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                bounce: <span className="text-foreground">{stats?.bounceRate ?? 0}%</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Control Panel */}
      <Card className="bg-white/5 backdrop-blur border-white/10">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base">Controls</CardTitle>
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 opacity-70" />
              Actions apply instantly. No sending happens inside the API.
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex items-center gap-3 flex-wrap">
          <Dialog open={startOpen} onOpenChange={setStartOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Zap className="h-4 w-4" /> Start Campaign
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-slate-950 border-white/10">
              <DialogHeader>
                <DialogTitle>Start a campaign</DialogTitle>
                <DialogDescription>
                  Choose a campaign to enqueue jobs. Sending happens in the worker process.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="text-sm text-muted-foreground">
                  Select a campaign to enqueue jobs. Sending happens in the worker process.
                </div>
                <Select value={campaignToStart} onValueChange={setCampaignToStart}>
                  <SelectTrigger className="bg-black/20 border-white/10">
                    <SelectValue placeholder="Select campaign" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-950 border-white/10">
                    {(campaigns ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center justify-end gap-2">
                  <Button variant="outline" onClick={() => setStartOpen(false)}>Cancel</Button>
                  <Button onClick={startSelectedCampaign} disabled={!campaignToStart}>Start</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {systemStatus === 'PAUSED' ? (
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => control.mutate({ action: 'resume' })}
              disabled={control.isPending}
            >
              <PlayCircle className="h-4 w-4" /> Resume System
            </Button>
          ) : (
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => control.mutate({ action: 'pause', payload: { reason: 'Paused from dashboard' } })}
              disabled={control.isPending}
            >
              <PauseCircle className="h-4 w-4" /> Pause System
            </Button>
          )}

          <Button
            variant="outline"
            className="gap-2"
            onClick={() => control.mutate({ action: 'optimize' })}
            disabled={control.isPending}
          >
            <RefreshCcw className="h-4 w-4" /> Run Optimizer
          </Button>

          <Button
            variant="outline"
            className="gap-2"
            onClick={() => control.mutate({ action: 'heal' })}
            disabled={control.isPending}
          >
            <ShieldAlert className="h-4 w-4" /> Self-Heal
          </Button>

          <Link href="/campaigns" className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground inline-flex items-center gap-2">
            Campaigns <ArrowRight className="h-4 w-4" />
          </Link>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-1 space-y-6">
          <SystemHealth health={health} analytics={analytics} />
          <PatternLeaderboard patterns={patterns} />
          <RecentDecisions analytics={analytics} actions={operatorActions} />
          <SelfHealActions health={health} actions={operatorActions} />
        </div>

        <div className="xl:col-span-2 space-y-6">
          <AgentFeed events={events} health={health} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="bg-white/5 backdrop-blur border-white/10">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Sending Volume</CardTitle>
              </CardHeader>
              <CardContent>
                {chartLoading ? <Skeleton className="h-72" /> : <DashboardSentChart data={chartData ?? []} />}
                <div className="mt-3 text-xs text-muted-foreground">
                  Local: run the worker to drain queue continuously:{' '}
                  <code className="px-2 py-0.5 rounded bg-black/30 text-foreground">npm run worker:dev</code>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white/5 backdrop-blur border-white/10">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Campaign Performance</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {campaignRows.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No campaigns yet.</div>
                ) : (
                  campaignRows.map((c) => (
                    <div key={c.id} className="rounded-lg border border-white/10 bg-black/20 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold truncate">{c.name}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            sent: <span className="text-foreground">{c.sent}</span> · replies: <span className="text-foreground">{c.replies}</span> · open: <span className="text-foreground">{c.openRate}%</span> · bounce: <span className="text-foreground">{c.bounceRate}%</span>
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className={c.trend === 'up'
                            ? 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30'
                            : 'bg-amber-500/15 text-amber-200 border-amber-500/30'}
                        >
                          {c.trend === 'up' ? 'TREND UP' : 'TREND DOWN'}
                        </Badge>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <DomainReputation analytics={analytics} />
        </div>
      </div>
    </div>
  )
}
