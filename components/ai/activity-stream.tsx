'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useRecentEvents } from '@/lib/hooks'
import { Activity, Mail, MessageCircle, ShieldAlert, AlertTriangle, Clock } from 'lucide-react'

function formatType(type: string): string {
  switch (type) {
    case 'sent':
      return 'EMAIL_SENT'
    case 'reply':
      return 'REPLY_CLASSIFIED'
    case 'bounce':
      return 'BOUNCE'
    case 'complaint':
      return 'COMPLAINT'
    case 'skipped':
      return 'SKIPPED'
    case 'retry':
      return 'RETRY'
    default:
      return type.toUpperCase()
  }
}

function iconFor(type: string) {
  if (type === 'sent') return Mail
  if (type === 'reply') return MessageCircle
  if (type === 'bounce' || type === 'complaint') return AlertTriangle
  if (type === 'skipped' || type === 'retry') return ShieldAlert
  return Activity
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime()
  const diff = Date.now() - t
  if (!Number.isFinite(diff) || diff < 0) return 'now'
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  return `${hr}h`
}

export function ActivityStreamPanel() {
  const { data: eventsPage } = useRecentEvents(70)

  const rows = useMemo(() => {
    const events = eventsPage?.data ?? []
    return events.slice(0, 70).map((e) => {
      const type = String(e.event_type)
      return {
        id: String(e.id),
        type,
        label: formatType(type),
        at: String(e.created_at),
        campaignId: e.campaign_id ? String(e.campaign_id) : null,
        domainId: e.domain_id ? String(e.domain_id) : null,
        meta: e.metadata,
      }
    })
  }, [eventsPage])

  return (
    <Card className="bg-white/5 backdrop-blur border-white/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4 opacity-80" />
          Live Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[260px] pr-3">
          <div className="space-y-2">
            {rows.length === 0 ? (
              <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-muted-foreground">
                No recent activity yet.
              </div>
            ) : (
              rows.map((r) => {
                const Icon = iconFor(r.type)
                return (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 p-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-8 w-8 rounded-md bg-white/5 border border-white/10 flex items-center justify-center">
                        <Icon className="h-4 w-4 opacity-80" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{r.label}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {r.campaignId ? `campaign ${r.campaignId}` : 'system'}{' '}
                          {r.domainId ? `· domain ${r.domainId}` : ''}
                        </div>
                      </div>
                    </div>
                    <Badge variant="outline" className="border-white/10 bg-black/10 text-muted-foreground gap-1">
                      <Clock className="h-3.5 w-3.5 opacity-70" />
                      {timeAgo(r.at)}
                    </Badge>
                  </div>
                )
              })
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
