'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useCampaigns, useExecutiveForecast, useExecutiveSummary, useInfrastructureAnalytics } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { ArrowDownRight, ArrowUpRight, Mail, Globe, MessageSquareText, AlertTriangle } from 'lucide-react'

function pct(value01: number): string {
  return `${Math.round(value01 * 10000) / 100}%`
}

function trendIcon(direction: 'up' | 'down') {
  return direction === 'up' ? ArrowUpRight : ArrowDownRight
}

function trendTone(kind: 'goodUp' | 'goodDown' | 'badUp' | 'badDown'): string {
  if (kind === 'goodUp' || kind === 'goodDown') return 'text-emerald-300'
  return 'text-rose-300'
}

function explain(summaryReplyTrendPct: number, infraRecTitle?: string): string {
  if (infraRecTitle) return infraRecTitle
  if (summaryReplyTrendPct <= -0.1) return 'Reply rate dropped. Likely subject fatigue or targeting mismatch.'
  if (summaryReplyTrendPct >= 0.1) return 'Reply rate improved. Maintain volume and keep patterns stable.'
  return 'System stable. Watch reply and bounce signals as volume increases.'
}

export function SystemInsightPanel() {
  const { data: summary } = useExecutiveSummary()
  const { data: forecast } = useExecutiveForecast(5)
  const { data: analytics } = useInfrastructureAnalytics()
  const { data: campaigns } = useCampaigns()

  const replyDir = forecast?.trends.reply.direction ?? 'up'
  const bounceDir = forecast?.trends.bounce.direction ?? 'down'
  const ReplyIcon = trendIcon(replyDir)
  const BounceIcon = trendIcon(bounceDir)

  const activeCampaigns = (campaigns ?? []).filter((c) => c.status === 'active')
  const domainHealth = analytics?.metrics
    ? `${analytics.metrics.healthyDomains}/${analytics.metrics.domains} healthy`
    : '…'

  const topRecTitle = analytics?.recommendations?.[0]?.title
  const explanation = explain(summary?.businessImpact.replyTrendPct ?? 0, topRecTitle)

  return (
    <Card className="bg-white/5 backdrop-blur border-white/10 h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 opacity-80" />
          System Insight
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <MessageSquareText className="h-3.5 w-3.5 opacity-70" />
              Reply trend
            </div>
            <div className="mt-1 flex items-center gap-2">
              <ReplyIcon className={cn('h-4 w-4', trendTone('goodUp'))} />
              <div className="text-sm font-semibold">
                {forecast ? forecast.trends.reply.text : 'Loading…'}
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 opacity-70" />
              Bounce trend
            </div>
            <div className="mt-1 flex items-center gap-2">
              <BounceIcon className={cn('h-4 w-4', bounceDir === 'down' ? trendTone('goodDown') : trendTone('badUp'))} />
              <div className="text-sm font-semibold">
                {forecast ? forecast.trends.bounce.text : 'Loading…'}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <Mail className="h-3.5 w-3.5 opacity-70" />
              Active campaigns
            </div>
            <div className="mt-1 flex items-center justify-between">
              <div className="text-2xl font-semibold">{activeCampaigns.length}</div>
              <Badge variant="outline" className="border-white/10 bg-black/10">
                today reply {summary ? pct(summary.today.replyRate) : '…'}
              </Badge>
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <Globe className="h-3.5 w-3.5 opacity-70" />
              Domain health
            </div>
            <div className="mt-1 flex items-center justify-between">
              <div className="text-2xl font-semibold">{domainHealth}</div>
              <Badge variant="outline" className="border-white/10 bg-black/10">
                spam {analytics ? `${analytics.metrics.health.avgSpamRate}%` : '…'}
              </Badge>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="text-xs text-muted-foreground">Explanation</div>
          <div className="mt-1 text-sm">{explanation}</div>
        </div>
      </CardContent>
    </Card>
  )
}

