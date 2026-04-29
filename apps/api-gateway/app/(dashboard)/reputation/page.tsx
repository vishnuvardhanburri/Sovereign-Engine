'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  DollarSign,
  Gauge,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  Zap,
} from 'lucide-react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type ProviderKey = 'gmail' | 'outlook' | 'yahoo' | 'other'
type LaneStatus = 'HEALTHY' | 'THROTTLED' | 'PAUSED'

type ProviderSummary = {
  provider: ProviderKey
  label: string
  status: LaneStatus
  domains: number
  pausedDomains: number
  throttledDomains: number
  maxPerHour: number
  maxConcurrency: number
  deferralRate1h: number
  blockRate1h: number
  sendSuccessRate1h: number
  seedPlacementInboxRate: number
  seedSample24h: number
}

type DomainOption = {
  id: number
  domain: string
  status: string
  dailyLimit: number
}

type LaneState = {
  id: number
  clientId: number
  domainId: number
  domain: string
  provider: ProviderKey
  label: string
  state: string
  status: LaneStatus
  maxPerHour: number
  maxPerMinute: number
  maxConcurrency: number
  cooldownUntil: string | null
  reasons: string[]
  updatedAt: string
  deferralRate1h: number
  blockRate1h: number
  sendSuccessRate1h: number
  throttleFactor: number
  providerSnapshotAt: string | null
  seedPlacementInboxRate: number
  seedSample24h: number
}

type ReputationEvent = {
  id: number
  createdAt: string
  provider: ProviderKey | null
  label: string
  eventType: string
  severity: 'info' | 'warning' | 'critical'
  message: string
  domainId: number | null
  domain: string | null
}

type RampPoint = {
  createdAt: string
  provider: ProviderKey
  label: string
  domainId: number | null
  domain: string | null
  maxPerHour: number
}

type ReputationMonitorResponse = {
  ok: boolean
  clientId: number
  domainId: number | null
  generatedAt: string
  domains: DomainOption[]
  providers: ProviderSummary[]
  states: LaneState[]
  events: ReputationEvent[]
  ramp: RampPoint[]
  investor?: {
    leadValueUsd: number
    costPerSendUsd: number
    infraDailyUsd: number
    proxyDailyUsd: number
    domainDailyUsd: number
    sentToday: number
    deliveredToday: number
    clickedToday: number
    repliesToday: number
    bouncesToday: number
    complaintsToday: number
    activeDomains: number
    activeCapacityPerHour: number
    projectedDailyCapacity: number
    estimatedInboxedToday: number
    avgInboxPlacementRate: number
    valueGeneratedUsd: number
    sendingCostsUsd: number
    variableDeliveryCostUsd: number
    fixedDeliveryCostUsd: number
    grossMarginUsd: number
    netProfitUsd: number
    roiMultiple: number | null
    successRate: number
    clickRate: number
    replyRate: number
    confidence: 'low' | 'medium' | 'high'
  }
}

const providerOrder: ProviderKey[] = ['gmail', 'outlook', 'yahoo', 'other']

const providerColors: Record<ProviderKey, string> = {
  gmail: '#2563eb',
  outlook: '#0891b2',
  yahoo: '#9333ea',
  other: '#f97316',
}

function pct(value: number, digits = 1) {
  return `${(Number(value || 0) * 100).toFixed(digits)}%`
}

function numberFmt(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(value || 0))
}

function moneyFmt(value: number) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(Number(value || 0))
}

function shortTime(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fullTime(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return date.toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })
}

function statusBadgeClass(status: LaneStatus) {
  if (status === 'HEALTHY') return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
  if (status === 'THROTTLED') return 'bg-amber-500/10 text-amber-600 border-amber-500/20'
  return 'bg-red-500/10 text-red-600 border-red-500/20'
}

function statusRingClass(status: LaneStatus) {
  if (status === 'HEALTHY') return 'border-emerald-500/40 bg-emerald-500/5'
  if (status === 'THROTTLED') return 'border-amber-500/40 bg-amber-500/5'
  return 'border-red-500/40 bg-red-500/5'
}

function severityClass(severity: ReputationEvent['severity']) {
  if (severity === 'critical') return 'bg-red-500/10 text-red-600 border-red-500/20'
  if (severity === 'warning') return 'bg-amber-500/10 text-amber-600 border-amber-500/20'
  return 'bg-sky-500/10 text-sky-600 border-sky-500/20'
}

function buildRampRows(points: RampPoint[]) {
  const current: Record<ProviderKey, number | null> = {
    gmail: null,
    outlook: null,
    yahoo: null,
    other: null,
  }

  return points.map((point, index) => {
    current[point.provider] = point.maxPerHour
    return {
      index: index + 1,
      time: shortTime(point.createdAt),
      domain: point.domain ?? 'All domains',
      gmail: current.gmail,
      outlook: current.outlook,
      yahoo: current.yahoo,
      other: current.other,
    }
  })
}

export default function ReputationDashboardPage() {
  const queryClient = useQueryClient()
  const [clientId, setClientId] = useState(1)
  const [domainId, setDomainId] = useState('all')
  const [busyOverride, setBusyOverride] = useState<string | null>(null)
  const [investorMode, setInvestorMode] = useState(false)

  useEffect(() => {
    setInvestorMode(new URLSearchParams(window.location.search).get('investor') === '1')
  }, [])

  const queryKey = ['reputation-monitor', clientId, domainId]
  const { data, isLoading, error, isFetching } = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ client_id: String(clientId) })
      if (domainId !== 'all') params.set('domain_id', domainId)
      const res = await fetch(`/api/reputation/monitor?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to load reputation monitor')
      return (await res.json()) as ReputationMonitorResponse
    },
    refetchInterval: 5_000,
  })

  const rampRows = useMemo(() => buildRampRows(data?.ramp ?? []), [data?.ramp])
  const states = data?.states ?? []
  const events = data?.events ?? []
  const providers = data?.providers ?? []
  const domains = data?.domains ?? []

  async function overrideLane(row: LaneState, action: 'pause' | 'resume') {
    const key = `${row.domainId}:${row.provider}:${action}`
    setBusyOverride(key)
    try {
      const res = await fetch('/api/reputation/override', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          domain_id: row.domainId,
          provider: row.provider,
          action,
        }),
      })
      if (!res.ok) throw new Error('Override failed')
      await queryClient.invalidateQueries({ queryKey: ['reputation-monitor'] })
    } finally {
      setBusyOverride(null)
    }
  }

  async function overrideAll(action: 'pause' | 'resume') {
    const key = `all:${action}`
    setBusyOverride(key)
    try {
      const payload: Record<string, unknown> = {
        client_id: clientId,
        action,
        scope: 'all',
      }
      if (domainId !== 'all') payload.domain_id = Number(domainId)

      const res = await fetch('/api/reputation/override', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(`${action === 'pause' ? 'Pause All' : 'Resume'} failed`)
      await queryClient.invalidateQueries({ queryKey: ['reputation-monitor'] })
    } finally {
      setBusyOverride(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground">
            <Activity className="h-3.5 w-3.5" />
            AdaptiveControlEngine live monitor
          </div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">Reputation Brain</h1>
          <p className="text-muted-foreground">
            Provider lanes, safe-ramp limits, and automatic pause/throttle decisions in one command center.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          Refreshes every 5s
          {data?.generatedAt ? <span>Last sample {shortTime(data.generatedAt)}</span> : null}
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-4 md:grid-cols-[180px_1fr] lg:grid-cols-[180px_280px_1fr]">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Client ID</label>
              <Input
                type="number"
                min={1}
                value={clientId}
                onChange={(event) => setClientId(Math.max(1, Number(event.target.value) || 1))}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Domain filter</label>
              <select
                value={domainId}
                onChange={(event) => setDomainId(event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="all">All domains</option>
                {domains.map((domain) => (
                  <option key={domain.id} value={domain.id}>
                    {domain.domain}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <div className="flex w-full flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2">
                <div className="text-sm text-muted-foreground">
                  Manual overrides write to Postgres + Redis immediately. Pause one lane, or stop every visible lane.
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busyOverride !== null || isLoading}
                    onClick={() => overrideAll('pause')}
                  >
                    <Pause className="mr-1 h-3.5 w-3.5" />
                    {busyOverride === 'all:pause' ? 'Pausing All' : 'Pause All'}
                  </Button>
                  <Button
                    size="sm"
                    disabled={busyOverride !== null || isLoading}
                    onClick={() => overrideAll('resume')}
                  >
                    <Play className="mr-1 h-3.5 w-3.5" />
                    {busyOverride === 'all:resume' ? 'Resuming' : 'Resume'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {data?.investor ? (
        <Card className="overflow-hidden border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 via-background to-cyan-500/10">
          <CardContent className="grid gap-4 pt-6 md:grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600">
                <DollarSign className="h-3.5 w-3.5" />
                Value Ticker
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                Estimated inboxed emails x {moneyFmt(data.investor.leadValueUsd)} average lead value.
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Estimated inboxed today</p>
              <p className="mt-1 text-3xl font-bold">{numberFmt(data.investor.estimatedInboxedToday)}</p>
              <p className="text-xs text-muted-foreground">
                Inbox rate model {pct(data.investor.avgInboxPlacementRate)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Net profit generated</p>
              <p className="mt-1 text-3xl font-bold text-emerald-600">{moneyFmt(data.investor.netProfitUsd)}</p>
              <p className="text-xs text-muted-foreground">
                {moneyFmt(data.investor.valueGeneratedUsd)} value - {moneyFmt(data.investor.sendingCostsUsd)} cost
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Live capacity</p>
              <p className="mt-1 text-3xl font-bold">{numberFmt(data.investor.activeCapacityPerHour)}/hr</p>
              <p className="text-xs text-muted-foreground">
                {numberFmt(data.investor.projectedDailyCapacity)} projected/day
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="flex items-center gap-3 pt-6 text-red-600">
            <AlertTriangle className="h-5 w-5" />
            Reputation monitor API failed. Check Postgres/Redis env and run migrations.
          </CardContent>
        </Card>
      ) : null}

      {investorMode && data?.investor ? (
        <Card className="overflow-hidden border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-background to-sky-500/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-emerald-600" />
              Investor View
              <Badge variant="outline" className="border-emerald-500/20 bg-emerald-500/10 text-emerald-600">
                hidden mode
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border bg-background/80 p-4">
                <p className="text-xs text-muted-foreground">Value generated today</p>
                <p className="mt-2 text-3xl font-bold tracking-tight">{moneyFmt(data.investor.valueGeneratedUsd)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {numberFmt(data.investor.estimatedInboxedToday)} inboxed x {moneyFmt(data.investor.leadValueUsd)}
                </p>
              </div>
              <div className="rounded-xl border bg-background/80 p-4">
                <p className="text-xs text-muted-foreground">Estimated sending cost</p>
                <p className="mt-2 text-3xl font-bold tracking-tight">{moneyFmt(data.investor.sendingCostsUsd)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {moneyFmt(data.investor.costPerSendUsd)} per send model
                </p>
              </div>
              <div className="rounded-xl border bg-background/80 p-4">
                <p className="text-xs text-muted-foreground">Gross margin proof</p>
                <p className="mt-2 text-3xl font-bold tracking-tight">{moneyFmt(data.investor.netProfitUsd)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  ROI {data.investor.roiMultiple ? `${data.investor.roiMultiple.toFixed(1)}x` : 'N/A'}
                </p>
              </div>
              <div className="rounded-xl border bg-background/80 p-4">
                <p className="text-xs text-muted-foreground">Signal quality</p>
                <p className="mt-2 text-3xl font-bold tracking-tight">{pct(data.investor.successRate)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Click {pct(data.investor.clickRate)} · Confidence {data.investor.confidence}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {isLoading
          ? Array.from({ length: 4 }).map((_, index) => (
              <Card key={index}>
                <CardContent className="space-y-4 pt-6">
                  <Skeleton className="h-6 w-28" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </CardContent>
              </Card>
            ))
          : providers.map((lane) => (
              <Card key={lane.provider} className={`border ${statusRingClass(lane.status)}`}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between text-base">
                    <span className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4" />
                      {lane.label}
                    </span>
                    <Badge variant="outline" className={statusBadgeClass(lane.status)}>
                      {lane.status}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Max/hr</p>
                      <p className="text-2xl font-bold">{numberFmt(lane.maxPerHour)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Concurrency</p>
                      <p className="text-2xl font-bold">{numberFmt(lane.maxConcurrency)}</p>
                    </div>
                  </div>
                  <div className="space-y-2 text-xs text-muted-foreground">
                    <div className="flex justify-between">
                      <span>Deferrals</span>
                      <span className="font-medium text-foreground">{pct(lane.deferralRate1h)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Blocks</span>
                      <span className="font-medium text-foreground">{pct(lane.blockRate1h)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Seed inbox</span>
                      <span className="font-medium text-foreground">
                        {lane.seedSample24h ? pct(lane.seedPlacementInboxRate) : 'No seed data'}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.45fr_0.85fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Safe-Ramp Graph
            </CardTitle>
          </CardHeader>
          <CardContent>
            {rampRows.length ? (
              <div className="h-[340px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsLineChart data={rampRows} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                    <XAxis dataKey="time" tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip
                      formatter={(value, name) => [value ? `${value}/hr` : 'No sample', String(name).toUpperCase()]}
                      labelFormatter={(label) => `Time ${label}`}
                    />
                    <Legend />
                    {providerOrder.map((provider) => (
                      <Line
                        key={provider}
                        type="monotone"
                        dataKey={provider}
                        name={provider === 'other' ? 'iCloud' : provider[0].toUpperCase() + provider.slice(1)}
                        stroke={providerColors[provider]}
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                      />
                    ))}
                  </RechartsLineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex h-[340px] flex-col items-center justify-center rounded-lg border border-dashed text-center text-sm text-muted-foreground">
                <Gauge className="mb-3 h-8 w-8" />
                No ramp events yet. The graph will populate when the Brain writes throttle/ramp state changes.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Real-Time Brain Feed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[340px] space-y-3 overflow-y-auto pr-1">
              {isLoading ? (
                Array.from({ length: 7 }).map((_, index) => <Skeleton key={index} className="h-16 w-full" />)
              ) : events.length ? (
                events.map((event) => (
                  <div key={event.id} className="rounded-lg border bg-background p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={severityClass(event.severity)}>
                          {event.severity}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{event.label}</span>
                      </div>
                      <span className="whitespace-nowrap text-xs text-muted-foreground">{shortTime(event.createdAt)}</span>
                    </div>
                    <p className="text-sm leading-relaxed">{event.message}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{event.domain ?? 'All domains'}</p>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  No reputation events yet.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SlidersHorizontal className="h-5 w-5" />
            Tenant and Domain Lane Controls
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Domain</TableHead>
                  <TableHead>Lane</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Max/hr</TableHead>
                  <TableHead>Signals</TableHead>
                  <TableHead>Seed inbox</TableHead>
                  <TableHead>Cooldown</TableHead>
                  <TableHead className="text-right">Override</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, index) => (
                    <TableRow key={index}>
                      {Array.from({ length: 8 }).map((__, cellIndex) => (
                        <TableCell key={cellIndex}>
                          <Skeleton className="h-4 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : states.length ? (
                  states.map((row) => {
                    const pauseKey = `${row.domainId}:${row.provider}:pause`
                    const resumeKey = `${row.domainId}:${row.provider}:resume`
                    const paused = row.status === 'PAUSED'
                    return (
                      <TableRow key={`${row.domainId}:${row.provider}`}>
                        <TableCell className="font-medium whitespace-nowrap">{row.domain}</TableCell>
                        <TableCell className="whitespace-nowrap">{row.label}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={statusBadgeClass(row.status)}>
                            {row.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold">{numberFmt(row.maxPerHour)}</TableCell>
                        <TableCell className="min-w-[220px] text-xs">
                          <div className="flex flex-wrap gap-2">
                            <span className="rounded bg-muted px-2 py-1">Def {pct(row.deferralRate1h)}</span>
                            <span className="rounded bg-muted px-2 py-1">Block {pct(row.blockRate1h)}</span>
                            <span className="rounded bg-muted px-2 py-1">Success {pct(row.sendSuccessRate1h)}</span>
                          </div>
                          {row.reasons.length ? (
                            <p className="mt-1 max-w-[280px] truncate text-muted-foreground">{row.reasons.join(', ')}</p>
                          ) : null}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {row.seedSample24h ? `${pct(row.seedPlacementInboxRate)} (${row.seedSample24h})` : 'No seed data'}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {row.cooldownUntil ? fullTime(row.cooldownUntil) : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busyOverride !== null || paused}
                              onClick={() => overrideLane(row, 'pause')}
                            >
                              <Pause className="mr-1 h-3.5 w-3.5" />
                              {busyOverride === pauseKey ? 'Pausing' : 'Pause'}
                            </Button>
                            <Button
                              size="sm"
                              disabled={busyOverride !== null || !paused}
                              onClick={() => overrideLane(row, 'resume')}
                            >
                              <Play className="mr-1 h-3.5 w-3.5" />
                              {busyOverride === resumeKey ? 'Resuming' : 'Resume'}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                      No reputation lane state yet. Start the reputation-worker and sender-worker to generate provider lane state.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
