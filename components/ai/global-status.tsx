'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { useExecutiveForecast, useExecutiveSummary, useInfrastructureAnalytics } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { Activity, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

type GlobalStatus = 'HEALTHY' | 'AT_RISK' | 'DEGRADED'
type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function tone(status: GlobalStatus): string {
  if (status === 'HEALTHY') return 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30'
  if (status === 'AT_RISK') return 'bg-amber-500/15 text-amber-200 border-amber-500/30'
  return 'bg-rose-500/15 text-rose-200 border-rose-500/30'
}

function riskTone(level: RiskLevel): string {
  if (level === 'LOW') return 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30'
  if (level === 'MEDIUM') return 'bg-amber-500/15 text-amber-200 border-amber-500/30'
  return 'bg-rose-500/15 text-rose-200 border-rose-500/30'
}

function computeRiskLevel(input: {
  projectedBounceRisk?: 'LOW' | 'MEDIUM' | 'HIGH'
  avgBounceRatePct?: number
  avgSpamRatePct?: number
}): RiskLevel {
  if (input.projectedBounceRisk === 'HIGH') return 'HIGH'
  const bounce = Number(input.avgBounceRatePct ?? 0) || 0
  const spam = Number(input.avgSpamRatePct ?? 0) || 0
  if (bounce >= 5 || spam >= 2.5) return 'HIGH'
  if (input.projectedBounceRisk === 'MEDIUM' || bounce >= 3 || spam >= 1.5) return 'MEDIUM'
  return 'LOW'
}

function computeGlobalStatus(level: RiskLevel, infraRecCount: number): GlobalStatus {
  if (level === 'HIGH') return 'DEGRADED'
  if (level === 'MEDIUM' || infraRecCount > 0) return 'AT_RISK'
  return 'HEALTHY'
}

function computeConfidenceScore(input: {
  infraRecommendationConfidence?: number
  dataFreshnessOk: boolean
}): number {
  const base = input.dataFreshnessOk ? 0.72 : 0.55
  const recConf = clamp01((Number(input.infraRecommendationConfidence ?? 80) || 80) / 100)
  return Math.round(clamp01(base * 0.7 + recConf * 0.3) * 100)
}

export function GlobalStatusBar() {
  const { data: summary } = useExecutiveSummary()
  const { data: forecast } = useExecutiveForecast(5)
  const { data: analytics } = useInfrastructureAnalytics()

  const [autonomousMode, setAutonomousMode] = useState(false)
  const [settingsLoading, setSettingsLoading] = useState(false)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        setSettingsLoading(true)
        const res = await fetch('/api/copilot/settings')
        const json = await res.json()
        if (!mounted) return
        if (res.ok && json.ok) {
          setAutonomousMode(Boolean(json.data?.autonomousMode))
        }
      } catch {
        // ignore
      } finally {
        if (mounted) setSettingsLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  // When autonomous mode is ON, tick the safe executor periodically.
  useEffect(() => {
    if (!autonomousMode) return
    const id = window.setInterval(() => {
      fetch('/api/copilot/auto', { method: 'POST' }).catch(() => {})
    }, 15000)
    return () => window.clearInterval(id)
  }, [autonomousMode])

  const toggleAutonomous = async (next: boolean) => {
    try {
      setSettingsLoading(true)
      const res = await fetch('/api/copilot/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autonomousMode: next }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to update')
      setAutonomousMode(Boolean(json.data?.autonomousMode))
      toast.success(`Autonomous Mode ${next ? 'ON' : 'OFF'}`)
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update Autonomous Mode')
    } finally {
      setSettingsLoading(false)
    }
  }

  const riskLevel = computeRiskLevel({
    projectedBounceRisk: forecast?.forecast.projectedBounceRisk,
    avgBounceRatePct: analytics?.metrics.health.avgBounceRate,
    avgSpamRatePct: analytics?.metrics.health.avgSpamRate,
  })

  const systemStatus = computeGlobalStatus(riskLevel, analytics?.recommendations?.length ?? 0)

  const topRecConf = analytics?.recommendations?.[0]?.confidence
  const confidenceScore = computeConfidenceScore({
    infraRecommendationConfidence: typeof topRecConf === 'number' ? topRecConf : undefined,
    dataFreshnessOk: Boolean(summary && forecast && analytics),
  })

  const summaryLine = (() => {
    if (!summary || !forecast || !analytics) return 'Loading system intelligence…'
    if (systemStatus === 'HEALTHY') return 'System stable. No immediate risks.'
    if (systemStatus === 'AT_RISK') return 'System is at risk. Recommendations available.'
    return 'System degraded. Apply fixes before scaling volume.'
  })()

  return (
    <Card className="bg-white/5 backdrop-blur border-white/10">
      <CardContent className="py-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 opacity-80" />
              <div className="text-sm font-semibold">Global State</div>
            </div>
            <div className="text-sm text-muted-foreground">{summaryLine}</div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={cn('border', tone(systemStatus))}>
              <ShieldAlert className="h-3.5 w-3.5 mr-1 opacity-80" />
              {systemStatus.replace('_', ' ')}
            </Badge>
            <Badge variant="outline" className={cn('border', riskTone(riskLevel))}>
              Risk: {riskLevel}
            </Badge>
            <Badge variant="outline" className="border-white/10 bg-black/20 text-foreground">
              Confidence: {confidenceScore}
            </Badge>
            <div className="flex items-center gap-2 rounded-md border border-white/10 bg-black/20 px-3 py-1.5">
              <div className="text-xs text-muted-foreground">Autonomous Mode</div>
              <Switch
                checked={autonomousMode}
                onCheckedChange={(v) => toggleAutonomous(Boolean(v))}
                disabled={settingsLoading}
              />
              <div className="text-xs font-medium">{autonomousMode ? 'ON' : 'OFF'}</div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
