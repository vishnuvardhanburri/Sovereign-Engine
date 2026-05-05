'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, Boxes, CheckCircle2, Database, RadioTower, Server, TimerReset, Wifi } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

type WorkerNode = {
  workerId?: string
  host?: string
  queue?: string
  lastSeenAt?: string
  concurrency?: number
  processedSends?: number
  resources?: {
    cpuPercent?: number
    rssMb?: number
  }
}

type HealthStats = {
  ok: boolean
  generatedAt: string
  redis?: {
    set_ok?: boolean
    get_ok?: boolean
  }
  postgres?: {
    reputation_state_count?: number
    reputation_state_last_updated_at?: string | null
  }
  bullmq?: {
    queue?: string
    waiting?: number
    active?: number
    delayed?: number
    failed?: number
  }
  workers?: {
    sender?: {
      active?: number
      stale?: number
      totalConcurrency?: number
      totalProcessedSends?: number
      nodes?: WorkerNode[]
    }
  }
  infrastructure_latency?: Record<string, number>
}

async function fetchHealthStats(): Promise<HealthStats> {
  const response = await fetch('/api/health/stats?client_id=1', { cache: 'no-store' })
  if (!response.ok) throw new Error('Failed to load health stats')
  return response.json()
}

function nodeTone(status: 'online' | 'idle' | 'warning') {
  if (status === 'online') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
  if (status === 'warning') return 'border-amber-500/25 bg-amber-500/10 text-amber-200'
  return 'border-white/10 bg-white/5 text-slate-200'
}

function shortId(value?: string) {
  if (!value) return 'local'
  if (value.length <= 18) return value
  return `${value.slice(0, 10)}...${value.slice(-5)}`
}

export function WorkerLiveMap() {
  const health = useQuery({
    queryKey: ['worker-live-map'],
    queryFn: fetchHealthStats,
    refetchInterval: 10_000,
  })

  const nodes = health.data?.workers?.sender?.nodes ?? []
  const activeWorkers = health.data?.workers?.sender?.active ?? 0
  const redisOnline = Boolean(health.data?.redis?.set_ok && health.data?.redis?.get_ok)
  const postgresOnline = Number(health.data?.postgres?.reputation_state_count ?? 0) >= 0
  const queueDepth = Number(health.data?.bullmq?.waiting ?? 0) + Number(health.data?.bullmq?.delayed ?? 0)

  const infrastructure = useMemo(
    () => [
      {
        label: 'API Gateway',
        detail: 'Next.js command plane',
        icon: Server,
        status: health.data?.ok ? 'online' : 'idle',
        metric: health.data?.generatedAt ? new Date(health.data.generatedAt).toLocaleTimeString() : 'checking',
      },
      {
        label: 'Postgres',
        detail: 'Reputation state + audit chain',
        icon: Database,
        status: postgresOnline ? 'online' : 'warning',
        metric: `${health.data?.postgres?.reputation_state_count ?? 0} lanes`,
      },
      {
        label: 'Redis',
        detail: 'Queue, cache, worker heartbeat',
        icon: Wifi,
        status: redisOnline ? 'online' : 'warning',
        metric: redisOnline ? 'SET/GET OK' : 'checking',
      },
      {
        label: 'BullMQ',
        detail: health.data?.bullmq?.queue || 'xv-send-queue',
        icon: Boxes,
        status: queueDepth > 5000 ? 'warning' : 'online',
        metric: `${queueDepth.toLocaleString()} waiting`,
      },
    ] as const,
    [health.data, postgresOnline, queueDepth, redisOnline]
  )

  return (
    <Card className="overflow-hidden border-cyan-500/15 bg-[radial-gradient(circle_at_top_left,_rgba(6,182,212,0.12),_transparent_35%),rgba(255,255,255,0.04)] backdrop-blur">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <RadioTower className="h-5 w-5 text-cyan-300" />
            Worker Live Map
          </CardTitle>
          <Badge variant="outline" className={activeWorkers > 0 ? nodeTone('online') : nodeTone('idle')}>
            {activeWorkers > 0 ? `${activeWorkers} muscle node${activeWorkers === 1 ? '' : 's'} online` : 'no sender worker heartbeat'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {health.isLoading ? (
          <Skeleton className="h-44 rounded-2xl" />
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              {infrastructure.map((item) => {
                const Icon = item.icon
                return (
                  <div key={item.label} className={`rounded-2xl border p-3 ${nodeTone(item.status)}`}>
                    <div className="flex items-center justify-between gap-2">
                      <Icon className="h-4 w-4" />
                      <CheckCircle2 className="h-4 w-4 opacity-70" />
                    </div>
                    <div className="mt-3 text-sm font-semibold">{item.label}</div>
                    <div className="text-xs text-slate-400">{item.detail}</div>
                    <div className="mt-2 font-mono text-xs">{item.metric}</div>
                  </div>
                )
              })}
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">Sender Nodes</div>
                <div className="text-xs text-muted-foreground">
                  total concurrency: {health.data?.workers?.sender?.totalConcurrency ?? 0}
                </div>
              </div>
              {nodes.length ? (
                <div className="grid gap-2 lg:grid-cols-2">
                  {nodes.slice(0, 6).map((node) => (
                    <div key={node.workerId || node.host} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-mono text-xs text-cyan-100">{shortId(node.workerId || node.host)}</div>
                          <div className="text-xs text-muted-foreground">{node.host || 'local worker'}</div>
                        </div>
                        <Badge variant="outline" className={nodeTone('online')}>
                          live
                        </Badge>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <div className="text-muted-foreground">CPU</div>
                          <div className="font-semibold">{Number(node.resources?.cpuPercent ?? 0).toFixed(1)}%</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">RSS</div>
                          <div className="font-semibold">{Number(node.resources?.rssMb ?? 0).toFixed(0)} MB</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Sends</div>
                          <div className="font-semibold">{Number(node.processedSends ?? 0).toLocaleString()}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-xl border border-dashed border-white/15 p-3 text-sm text-muted-foreground">
                  <TimerReset className="h-4 w-4" />
                  Start `pnpm worker:sender` or the Docker sender-worker service to show live muscle nodes.
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Activity className="h-3.5 w-3.5" />
                Redis set/get: {health.data?.infrastructure_latency?.redis_get_ms ?? 0}ms
              </span>
              <span>DB reputation query: {health.data?.infrastructure_latency?.db_reputation_state_ms ?? 0}ms</span>
              <span>BullMQ counts: {health.data?.infrastructure_latency?.bullmq_counts_ms ?? 0}ms</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
