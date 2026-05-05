'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { PatternRecord } from '@/lib/api'

function typeTone(type: PatternRecord['type']): string {
  if (type === 'subject') return 'bg-sky-500/15 text-sky-200 border-sky-500/30'
  if (type === 'intro') return 'bg-violet-500/15 text-violet-200 border-violet-500/30'
  return 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30'
}

export function PatternLeaderboard(props: { patterns?: PatternRecord[]; loading?: boolean }) {
  const patterns = (props.patterns ?? []).filter((p) => p.status !== 'disabled')
  const top = patterns.slice().sort((a, b) => (b.score - a.score) || (b.reply_rate - a.reply_rate)).slice(0, 8)

  return (
    <Card className="bg-white/5 backdrop-blur border-white/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Pattern Learning</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {top.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No patterns yet. Once emails start sending, the system will rank subjects and intros automatically.
          </div>
        ) : (
          <div className="space-y-2">
            {top.map((p) => (
              <div key={p.id} className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{p.content}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      reply: <span className="text-foreground">{Math.round(p.reply_rate * 100)}%</span> · open: <span className="text-foreground">{Math.round(p.open_rate * 100)}%</span> · bounce: <span className="text-foreground">{Math.round(p.bounce_rate * 100)}%</span> · used: <span className="text-foreground">{p.usage_count}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <Badge variant="outline" className={typeTone(p.type)}>
                      {p.type.toUpperCase()}
                    </Badge>
                    <div className="text-sm font-semibold">
                      {Number.isFinite(p.score) ? p.score.toFixed(1) : '0.0'}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

