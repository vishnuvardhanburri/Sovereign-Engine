'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface InfrastructureState {
  capacity: {
    current: number
    target: number
    utilization: number
    utilizationPercent: string
    gap: number
  }
  domains: {
    healthy: number
    totalInboxes: number
    inboxesPerDomain: number
    capacityPerDomain: number
  }
  health: {
    status: string
    isHealthy: boolean
    issueCount: number
    issues: string[]
    lastCheck: string
  }
  system: {
    isPaused: boolean
    lastOptimization: string
    autoHealingEnabled: boolean
    backgroundMonitoring: boolean
  }
}

interface DistributionData {
  summary: {
    totalInboxes: number
    healthyInboxes: number
    fullyUsedInboxes: number
    availableCapacity: number
    averageUtilization: number
    averageUtilizationPercent: string
  }
  distributions: any[]
  topUtilized: any[]
  topAvailable: any[]
}

export function InfrastructureDashboard() {
  const [state, setState] = useState<InfrastructureState | null>(null)
  const [distribution, setDistribution] = useState<DistributionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [isPaused, setIsPaused] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  const fetchData = async () => {
    try {
      const [stateRes, distRes, controlRes] = await Promise.all([
        fetch('/api/infrastructure/status'),
        fetch('/api/infrastructure/distribution'),
        fetch('/api/infrastructure/control'),
      ])

      if (stateRes.ok && distRes.ok && controlRes.ok) {
        const stateData = await stateRes.json()
        const distData = await distRes.json()
        const controlData = await controlRes.json()

        setState(stateData.data)
        setDistribution(distData.data)
        setIsPaused(controlData.data.isPaused)
      }
    } catch (error) {
      console.error('Failed to fetch infrastructure data:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 10000) // Refresh every 10 seconds
    return () => clearInterval(interval)
  }, [])

  const handlePause = async () => {
    setActionLoading(true)
    try {
      const res = await fetch('/api/infrastructure/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'pause',
          reason: 'Manual pause via dashboard',
        }),
      })
      if (res.ok) {
        setIsPaused(true)
      }
    } catch (error) {
      console.error('Failed to pause:', error)
    } finally {
      setActionLoading(false)
    }
  }

  const handleResume = async () => {
    setActionLoading(true)
    try {
      const res = await fetch('/api/infrastructure/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resume' }),
      })
      if (res.ok) {
        setIsPaused(false)
      }
    } catch (error) {
      console.error('Failed to resume:', error)
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) {
    return <div className="p-4">Loading infrastructure data...</div>
  }

  if (!state || !distribution) {
    return <div className="p-4 text-red-500">Failed to load infrastructure data</div>
  }

  const capacityPercent = Math.round(state.capacity.utilization)
  const healthStatus = state.health.status
  const healthColor =
    healthStatus === 'healthy'
      ? 'bg-green-500'
      : healthStatus === 'degraded'
        ? 'bg-yellow-500'
        : 'bg-red-500'

  return (
    <div className="space-y-4">
      {/* Top Alert Bar */}
      {state.system.isPaused && (
        <Alert className="bg-red-50 border-red-300">
          <AlertDescription className="text-red-800">
            ⚠️ Infrastructure sending is PAUSED. Use "Resume" button below to continue.
          </AlertDescription>
        </Alert>
      )}

      {!state.health.isHealthy && state.health.issueCount > 0 && (
        <Alert className="bg-yellow-50 border-yellow-300">
          <AlertDescription className="text-yellow-800">
            ⚠️ {state.health.issueCount} infrastructure issue(s) detected. Monitor closely.
          </AlertDescription>
        </Alert>
      )}

      {capacityPercent > 90 && (
        <Alert className="bg-orange-50 border-orange-300">
          <AlertDescription className="text-orange-800">
            ⚡ Capacity utilization is critical ({capacityPercent}%). Auto-scaling should trigger.
          </AlertDescription>
        </Alert>
      )}

      {/* Capacity Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Capacity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Current Capacity</span>
              <span className="font-semibold">{state.capacity.current.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Target Daily Volume</span>
              <span className="font-semibold">{state.capacity.target.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Capacity Gap</span>
              <span className={`font-semibold ${state.capacity.gap > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                {state.capacity.gap > 0 ? '+' : ''}{state.capacity.gap.toLocaleString()}
              </span>
            </div>
          </div>

          <div>
            <div className="flex justify-between mb-2">
              <span className="text-sm font-medium">Utilization</span>
              <span className="text-sm font-semibold">{state.capacity.utilizationPercent}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div
                className={`h-full transition-all ${
                  capacityPercent > 90
                    ? 'bg-red-500'
                    : capacityPercent > 75
                      ? 'bg-yellow-500'
                      : 'bg-green-500'
                }`}
                style={{ width: `${Math.min(capacityPercent, 100)}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {state.capacity.gap > 0
                ? `Need ${Math.ceil(state.capacity.gap / state.domains.capacityPerDomain)} more domains`
                : 'Healthy capacity levels'}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Health Status Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">System Health</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <div className={`w-4 h-4 rounded-full ${healthColor}`} />
            <span className="font-semibold capitalize">{healthStatus}</span>
            <span className="text-sm text-gray-500">
              (last check {new Date(state.health.lastCheck).toLocaleTimeString()})
            </span>
          </div>

          {state.health.issueCount > 0 && (
            <div className="bg-red-50 border border-red-200 rounded p-3">
              <p className="text-sm font-semibold text-red-700 mb-2">
                {state.health.issueCount} Issue{state.health.issueCount > 1 ? 's' : ''}:
              </p>
              <ul className="space-y-1">
                {state.health.issues.slice(0, 5).map((issue, i) => (
                  <li key={i} className="text-sm text-red-600">
                    • {issue}
                  </li>
                ))}
              </ul>
              {state.health.issues.length > 5 && (
                <p className="text-xs text-red-500 mt-2">
                  +{state.health.issues.length - 5} more issues
                </p>
              )}
            </div>
          )}

          {state.health.isHealthy && (
            <div className="bg-green-50 border border-green-200 rounded p-3">
              <p className="text-sm text-green-700">✓ All systems operating normally</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Domains & Inboxes Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Infrastructure</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Healthy Domains</p>
            <p className="text-2xl font-bold">{state.domains.healthy}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Total Inboxes</p>
            <p className="text-2xl font-bold">{state.domains.totalInboxes}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Inboxes/Domain</p>
            <p className="text-2xl font-bold">{state.domains.inboxesPerDomain}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Per-Domain Capacity</p>
            <p className="text-2xl font-bold">{state.domains.capacityPerDomain}</p>
          </div>
        </CardContent>
      </Card>

      {/* Distribution Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Distribution</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Healthy Inboxes</p>
              <p className="text-2xl font-bold">
                {distribution.summary.healthyInboxes} / {distribution.summary.totalInboxes}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Fully Used</p>
              <p className="text-2xl font-bold text-orange-600">
                {distribution.summary.fullyUsedInboxes}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Available Capacity</p>
              <p className="text-2xl font-bold text-green-600">
                {distribution.summary.availableCapacity}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Avg Utilization</p>
              <p className="text-2xl font-bold">{distribution.summary.averageUtilizationPercent}</p>
            </div>
          </div>

          {distribution.topUtilized.length > 0 && (
            <div>
              <p className="text-sm font-semibold mb-2">Most Utilized Inboxes</p>
              <div className="space-y-1">
                {distribution.topUtilized.map((inbox, i) => (
                  <div key={i} className="flex justify-between text-xs text-gray-600">
                    <span>{inbox.inbox.split('@')[0]}@{inbox.domain.substring(0, 15)}...</span>
                    <span className="font-semibold">{inbox.utilization}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* System Status Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">System Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between">
              <span>Sending Status</span>
              <span
                className={`px-3 py-1 rounded-full text-sm font-semibold ${
                  isPaused
                    ? 'bg-red-100 text-red-800'
                    : 'bg-green-100 text-green-800'
                }`}
              >
                {isPaused ? 'PAUSED' : 'RUNNING'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Auto-Healing</span>
              <span className="text-sm">
                {state.system.autoHealingEnabled ? '✓ Enabled' : '✗ Disabled'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Background Monitoring</span>
              <span className="text-sm">
                {state.system.backgroundMonitoring ? '✓ Active' : '✗ Inactive'}
              </span>
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>Last Optimization</span>
              <span>{new Date(state.system.lastOptimization).toLocaleTimeString()}</span>
            </div>
          </div>

          {/* Control Buttons */}
          <div className="flex gap-2 pt-2 border-t">
            {isPaused ? (
              <Button
                onClick={handleResume}
                disabled={actionLoading}
                className="w-full bg-green-600 hover:bg-green-700"
              >
                {actionLoading ? 'Resuming...' : 'Resume Sending'}
              </Button>
            ) : (
              <Button
                onClick={handlePause}
                disabled={actionLoading}
                variant="outline"
                className="w-full text-red-600 hover:bg-red-50"
              >
                {actionLoading ? 'Pausing...' : 'Pause Sending'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Last Updated */}
      <div className="text-xs text-gray-500 text-center py-2">
        Last updated: {new Date().toLocaleTimeString()} (auto-refreshes every 10 seconds)
      </div>
    </div>
  )
}
