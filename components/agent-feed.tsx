'use client'

import { useEffect, useMemo, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { EventRow, InfrastructureHealth, PaginatedResponse } from '@/lib/api'

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function eventTone(type: string): 'good' | 'warn' | 'bad' | 'neutral' {
  const t = type.toLowerCase()
  if (t === 'sent' || t === 'delivered' || t === 'opened' || t === 'clicked') return 'good'
  if (t === 'reply') return 'good'
  if (t === 'retry' || t === 'queued' || t === 'skipped') return 'warn'
  if (t === 'failed' || t === 'bounce' || t === 'complaint') return 'bad'
  return 'neutral'
}

function badgeClass(level: ReturnType<typeof eventTone>): string {
  if (level === 'good') return 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30'
  if (level === 'warn') return 'bg-amber-500/15 text-amber-200 border-amber-500/30'
  if (level === 'bad') return 'bg-rose-500/15 text-rose-200 border-rose-500/30'
  return 'bg-white/5 text-slate-200 border-white/10'
}

type FeedItem =
  | { kind: 'event'; id: string; at: string; label: string; detail?: string }
  | { kind: 'alert'; id: string; at: string; label: string; detail?: string }

export function AgentFeed(props: {
  events?: PaginatedResponse<EventRow>
  health?: InfrastructureHealth
  loading?: boolean
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const items: FeedItem[] = useMemo(() => {
    const out: FeedItem[] = []

    for (const ev of props.events?.data ?? []) {
      const label = ev.event_type.toUpperCase()
      const meta = ev.metadata ?? {}
      const detail =
        typeof meta.message === 'string'
          ? meta.message
          : typeof meta.reason === 'string'
          ? meta.reason
          : typeof meta.subject === 'string'
          ? meta.subject
          : undefined

      out.push({
        kind: 'event',
        id: `ev_${ev.id}`,
        at: ev.created_at,
        label,
        detail,
      })
    }

    const alerts = props.health?.alerts?.recent ?? []
    for (let i = 0; i < alerts.length; i += 1) {
      const raw = alerts[i] as Record<string, unknown>
      const at = typeof raw.timestamp === 'string' ? raw.timestamp : props.health?.timestamp ?? new Date().toISOString()
      const label = typeof raw.title === 'string' ? raw.title : 'ALERT'
      const detail = typeof raw.message === 'string' ? raw.message : undefined
      out.push({
        kind: 'alert',
        id: `al_${i}_${at}`,
        at,
        label,
        detail,
      })
    }

    return out.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
  }, [props.events, props.health])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [items.length])

  return (
    <Card className="bg-white/5 backdrop-blur border-white/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Live Activity Feed</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          ref={scrollRef}
          className="h-[340px] overflow-auto rounded-lg border border-white/10 bg-black/20"
        >
          {items.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No recent activity yet.</div>
          ) : (
            <div className="divide-y divide-white/5">
              {items.slice(-120).map((item) => {
                const level = item.kind === 'event' ? eventTone(item.label) : 'warn'
                return (
                  <div key={item.id} className="px-3 py-2 flex items-start gap-3">
                    <div className="w-14 shrink-0 text-xs text-muted-foreground pt-1">{fmtTime(item.at)}</div>
                    <Badge variant="outline" className={`${badgeClass(level)} shrink-0`}>
                      {item.kind === 'event' ? item.label : 'ALERT'}
                    </Badge>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{item.kind === 'event' ? item.label : item.label}</div>
                      {item.detail ? (
                        <div className="text-xs text-muted-foreground truncate">{item.detail}</div>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

