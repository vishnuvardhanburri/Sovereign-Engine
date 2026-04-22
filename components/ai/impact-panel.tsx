'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sparkles, TrendingDown, TrendingUp } from 'lucide-react'

type ImpactRow = {
  id: string
  action_kind: string
  action_summary: string
  created_at: string
  summaryLines: string[]
}

export function ImpactPanel() {
  const [rows, setRows] = useState<ImpactRow[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let mounted = true
    const fetchImpacts = async () => {
      setLoading(true)
      try {
        const res = await fetch('/api/copilot/impacts?limit=10')
        const json = await res.json()
        if (!mounted) return
        if (res.ok && json.ok) {
          setRows(Array.isArray(json.data) ? json.data : [])
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }

    fetchImpacts()
    const id = window.setInterval(fetchImpacts, 15000)
    return () => {
      mounted = false
      window.clearInterval(id)
    }
  }, [])

  return (
    <Card className="bg-white/5 backdrop-blur border-white/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 opacity-80" />
          AI Impact
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[220px] pr-3">
          <div className="space-y-2">
            {loading && rows.length === 0 ? (
              <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-muted-foreground">
                Loading impact history…
              </div>
            ) : rows.length === 0 ? (
              <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-muted-foreground">
                No tracked impact yet. Execute an action to start building a feedback loop.
              </div>
            ) : (
              rows.map((r) => (
                <div key={r.id} className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{r.action_summary}</div>
                      <div className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</div>
                    </div>
                    <Badge variant="outline" className="border-white/10 bg-black/10">
                      {String(r.action_kind).replaceAll('_', ' ').toUpperCase()}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    {(r.summaryLines ?? []).slice(0, 3).map((line, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-xs">
                        {line.toLowerCase().includes('reduced') ? (
                          <TrendingDown className="h-3.5 w-3.5 text-emerald-300" />
                        ) : line.toLowerCase().includes('improved') ? (
                          <TrendingUp className="h-3.5 w-3.5 text-emerald-300" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5 opacity-70" />
                        )}
                        <span className="text-muted-foreground">{line}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

