'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, Database, History, RefreshCw, ShieldCheck, Zap } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type ReplayEvent = {
  id: string
  type: string
  title: string
  message: string
  severity: 'info' | 'warning' | 'critical'
  source: 'reputation' | 'delivery' | 'audit'
  createdAt: string
  metadata?: Record<string, unknown>
}

type ReplayResponse = {
  ok: boolean
  generatedAt: string
  summary: {
    total: number
    reputation: number
    delivery: number
    audit: number
    usingSampleData: boolean
  }
  events: ReplayEvent[]
}

const sourceIcons = {
  reputation: Activity,
  delivery: Zap,
  audit: ShieldCheck,
}

const metricCards = [
  { label: 'Total Events', key: 'total' as const, Icon: Database },
  { label: 'Reputation', key: 'reputation' as const, Icon: Activity },
  { label: 'Delivery', key: 'delivery' as const, Icon: Zap },
  { label: 'Audit Chain', key: 'audit' as const, Icon: ShieldCheck },
]

function severityClass(severity: ReplayEvent['severity']) {
  if (severity === 'critical') return 'border-red-500/20 bg-red-500/10 text-red-600'
  if (severity === 'warning') return 'border-amber-500/20 bg-amber-500/10 text-amber-600'
  return 'border-sky-500/20 bg-sky-500/10 text-sky-600'
}

function timeAgo(value: string) {
  const diff = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(diff)) return value
  const minutes = Math.max(0, Math.round(diff / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.round(minutes / 60)}h ago`
}

async function fetchReplay(): Promise<ReplayResponse> {
  const response = await fetch('/api/activity/replay?limit=120', { cache: 'no-store' })
  if (!response.ok) throw new Error('Failed to load replay')
  return response.json()
}

export default function ActivityReplayPage() {
  const [source, setSource] = useState<'all' | ReplayEvent['source']>('all')
  const replay = useQuery({
    queryKey: ['activity-replay'],
    queryFn: fetchReplay,
    refetchInterval: 15_000,
  })

  const events = useMemo(() => {
    const rows = replay.data?.events ?? []
    return source === 'all' ? rows : rows.filter((item) => item.source === source)
  }, [replay.data?.events, source])

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.16),_transparent_36%),linear-gradient(135deg,_hsl(var(--card)),_hsl(var(--background)))] p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Badge variant="outline" className="mb-3 border-emerald-500/20 bg-emerald-500/10 text-emerald-600">
              <History className="mr-1 h-3 w-3" />
              System Activity Replay
            </Badge>
            <h1 className="text-3xl font-semibold tracking-tight">Watch the Brain Work</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              A timeline that blends reputation events, delivery events, and immutable audit actions into one buyer-ready operational story.
            </p>
          </div>
          <Button variant="outline" onClick={() => replay.refetch()} disabled={replay.isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${replay.isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {metricCards.map(({ label, key, Icon }) => (
          <Card key={label}>
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <div className="text-2xl font-semibold">{replay.data?.summary[key] ?? 0}</div>
                <div className="text-sm text-muted-foreground">{label}</div>
              </div>
              <Icon className="h-5 w-5 text-muted-foreground" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <CardTitle>Live Brain Feed</CardTitle>
            <div className="flex flex-wrap gap-2">
              {(['all', 'reputation', 'delivery', 'audit'] as const).map((item) => (
                <Button
                  key={item}
                  variant={source === item ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSource(item)}
                >
                  {item}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {replay.data?.summary.usingSampleData ? (
            <div className="mb-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4 text-sm text-cyan-700">
              No production events yet, so this page is showing safe demo events. Run the buyer demo or stress test to populate real rows.
            </div>
          ) : null}
          <div className="space-y-3">
            {events.map((event) => {
              const Icon = sourceIcons[event.source]
              return (
                <div key={event.id} className="flex gap-3 rounded-2xl border p-4">
                  <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium">{event.title}</div>
                      <Badge variant="outline" className={severityClass(event.severity)}>
                        {event.severity}
                      </Badge>
                      <Badge variant="secondary">{event.source}</Badge>
                      <span className="text-xs text-muted-foreground">{timeAgo(event.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{event.message}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
