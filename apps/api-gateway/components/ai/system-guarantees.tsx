'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useExecutiveForecast, useInfrastructureAnalytics, useQueueStats } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { ShieldCheck, ShieldAlert, AlertTriangle, Gauge, Clock, Lock, Wrench } from 'lucide-react'

type DeliverabilityStatus = 'STABLE' | 'RISK' | 'DEGRADED'

type GuaranteesData = {
  ok: true
  data: {
    timestamp: string
    deliverabilityStatus: DeliverabilityStatus
    uptime24hPct: number
    errorRatePct24h: number
    counts24h: { sent: number; failed: number; bounce: number; complaint: number; unsubscribed: number }
    compliance: { violationsDetected: boolean; complaintCount24h: number; unsubscribedCount24h: number }
  }
} | { ok: false; error: string }

function statusTone(status: DeliverabilityStatus): string {
  if (status === 'STABLE') return 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30'
  if (status === 'RISK') return 'bg-amber-500/15 text-amber-200 border-amber-500/30'
  return 'bg-rose-500/15 text-rose-200 border-rose-500/30'
}

export function SystemGuaranteesPanel() {
  const { data: forecast } = useExecutiveForecast(5)
  const { data: analytics } = useInfrastructureAnalytics()
  const { data: queue } = useQueueStats()

  const [snapshot, setSnapshot] = useState<GuaranteesData | null>(null)

  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const res = await fetch('/api/copilot/guarantees')
        const json = (await res.json()) as GuaranteesData
        if (!mounted) return
        setSnapshot(json)
      } catch {
        if (mounted) setSnapshot({ ok: false, error: 'Failed to load guarantees' })
      }
    }

    load()
    const id = window.setInterval(load, 12000)
    return () => {
      mounted = false
      window.clearInterval(id)
    }
  }, [])

  const guarantees = useMemo(() => {
    const utilization = analytics?.metrics.capacity.utilization ?? 0
    const safeRemaining = forecast?.forecast.estimatedSafeSendCapacityRemaining ?? null
    const withinSafeLimits = safeRemaining === null ? utilization < 90 : safeRemaining >= 0

    const allDomainsHealthy = analytics
      ? analytics.metrics.domains > 0 && analytics.metrics.healthyDomains === analytics.metrics.domains
      : false

    const noComplianceViolations = snapshot?.ok ? snapshot.data.compliance.violationsDetected === false : false

    return {
      withinSafeLimits,
      allDomainsHealthy,
      noComplianceViolations,
    }
  }, [analytics, forecast, snapshot])

  const protections = useMemo(() => {
    const bounceSpikeProtection = Boolean(
      forecast?.earlyWarnings?.some((w) => String(w).toLowerCase().includes('bounce risk'))
    )
    const domainProtection = Boolean(
      (analytics?.metrics.health.avgBounceRate ?? 0) < 5 && (analytics?.metrics.health.avgSpamRate ?? 0) < 2.5
    )
    const queueRecovery = Boolean((queue?.scheduled ?? 0) > 0 || (queue?.ready ?? 0) > 0)
    return {
      bounceSpikeProtection,
      domainProtection,
      queueRecovery,
    }
  }, [analytics, forecast, queue])

  const deliverabilityStatus: DeliverabilityStatus =
    snapshot?.ok ? snapshot.data.deliverabilityStatus : 'RISK'

  return (
    <Card className="bg-white/5 backdrop-blur border-white/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 opacity-80" />
          System Guarantees
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Badge variant="outline" className={cn('border', statusTone(deliverabilityStatus))}>
            Deliverability: {deliverabilityStatus}
          </Badge>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="border-white/10 bg-black/20 text-muted-foreground gap-1">
              <Clock className="h-3.5 w-3.5 opacity-70" />
              Uptime 24h: {snapshot?.ok ? `${snapshot.data.uptime24hPct}%` : '…'}
            </Badge>
            <Badge variant="outline" className="border-white/10 bg-black/20 text-muted-foreground gap-1">
              <AlertTriangle className="h-3.5 w-3.5 opacity-70" />
              Error rate: {snapshot?.ok ? `${snapshot.data.errorRatePct24h}%` : '…'}
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <Gauge className="h-3.5 w-3.5 opacity-70" />
              Safe limits
            </div>
            <div className="mt-1 text-sm font-medium">
              {guarantees.withinSafeLimits ? 'Send rate is within safe limits' : 'Send rate approaching unsafe limits'}
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <ShieldAlert className="h-3.5 w-3.5 opacity-70" />
              Domain thresholds
            </div>
            <div className="mt-1 text-sm font-medium">
              {guarantees.allDomainsHealthy ? 'All domains operating within healthy thresholds' : 'Some domains are outside healthy thresholds'}
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <Lock className="h-3.5 w-3.5 opacity-70" />
              Compliance
            </div>
            <div className="mt-1 text-sm font-medium">
              {guarantees.noComplianceViolations ? 'No compliance violations detected' : 'Compliance signal detected (complaints)'}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-black/20 p-3 flex items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="text-sm font-semibold">Risk Boundary Active</div>
            <div className="text-xs text-muted-foreground">
              Automatic throttling enforces safe thresholds. The engine will not exceed safe limits.
            </div>
          </div>
          <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-200">
            ACTIVE
          </Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <Wrench className="h-3.5 w-3.5 opacity-70" />
              Bounce spike protection
            </div>
            <div className="mt-1 flex items-center justify-between">
              <div className="text-sm font-medium">{protections.bounceSpikeProtection ? 'ACTIVE' : 'STANDBY'}</div>
              <Badge variant="outline" className="border-white/10 bg-black/10 text-muted-foreground">
                {forecast?.forecast.projectedBounceRisk ?? '…'}
              </Badge>
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5 opacity-70" />
              Domain protection
            </div>
            <div className="mt-1 text-sm font-medium">{protections.domainProtection ? 'ACTIVE' : 'AT RISK'}</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <Wrench className="h-3.5 w-3.5 opacity-70" />
              Queue recovery
            </div>
            <div className="mt-1 text-sm font-medium">{protections.queueRecovery ? 'ACTIVE' : 'STANDBY'}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

