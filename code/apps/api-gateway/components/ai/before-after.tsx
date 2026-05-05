'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useExecutiveForecast, useExecutiveSummary } from '@/lib/hooks'
import { useViewMode } from '@/components/ai/view-mode'
import { TrendingDown, TrendingUp } from 'lucide-react'

function pct01(x: number): string {
  return `${Math.round((Number(x) || 0) * 10000) / 100}%`
}

function deltaPct(before01: number, after01: number): number {
  const b = Number(before01) || 0
  const a = Number(after01) || 0
  if (b <= 0) return 0
  return (a - b) / b
}

export function BeforeAfterPanel() {
  const { viewMode, demoState } = useViewMode()
  const { data: summary } = useExecutiveSummary()
  const { data: forecast } = useExecutiveForecast(5)

  // "Before" comes from Demo Mode (when enabled), otherwise fall back to forecast baselines.
  // This keeps the panel grounded and avoids introducing new fields on ExecutiveSummary types.
  const before = demoState?.beforeAfter?.before ?? forecast?.baselines ?? null
  const after = summary?.today ?? null

  const beforeReply = Number(before?.replyRate ?? before?.avgReplyRate ?? 0) || 0
  const beforeBounce = Number(before?.bounceRate ?? before?.avgBounceRate ?? 0) || 0
  const afterReply = Number(after?.replyRate ?? 0) || 0
  const afterBounce = Number(after?.bounceRate ?? 0) || 0

  const replyDelta = deltaPct(beforeReply, afterReply)
  const bounceDelta = deltaPct(beforeBounce, afterBounce)

  const improvedReplyPct = Math.round(replyDelta * 1000) / 10
  const reducedBouncePct = Math.round(Math.max(0, -bounceDelta) * 1000) / 10

  if (viewMode === 'client' && !summary) {
    // Client view should never be blank.
    return (
      <Card className="bg-white/5 backdrop-blur border-white/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Before → After</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Loading impact baseline…
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="bg-white/5 backdrop-blur border-white/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Before → After</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="text-xs text-muted-foreground">Reply rate</div>
            <div className="mt-1 flex items-center justify-between">
              <div className="text-sm font-semibold">
                {pct01(beforeReply)} → {pct01(afterReply)}
              </div>
              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-200">
                <TrendingUp className="h-3.5 w-3.5 mr-1 opacity-80" />
                {improvedReplyPct >= 0 ? `+${improvedReplyPct}%` : `${improvedReplyPct}%`}
              </Badge>
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="text-xs text-muted-foreground">Bounce rate</div>
            <div className="mt-1 flex items-center justify-between">
              <div className="text-sm font-semibold">
                {pct01(beforeBounce)} → {pct01(afterBounce)}
              </div>
              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-200">
                <TrendingDown className="h-3.5 w-3.5 mr-1 opacity-80" />
                {Math.round(bounceDelta * 1000) / 10}%
              </Badge>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm">
          Improved reply rate by <span className="font-semibold">{improvedReplyPct}%</span>, reduced bounce by{' '}
          <span className="font-semibold">{reducedBouncePct}%</span>.
        </div>
      </CardContent>
    </Card>
  )
}
