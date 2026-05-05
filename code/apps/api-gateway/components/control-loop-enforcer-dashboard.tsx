/**
 * Control Loop Enforcer Dashboard Component
 * Provides interface to trigger and monitor the unbreakable email sending system
 */

'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'

interface ControlLoopResult {
  target: number
  sent: number
  status: 'completed' | 'forced_completion'
  scaling_used: boolean
  retries: number
  duration_ms: number
  start_time: string
  end_time: string
  final_capacity: number
  buffer_capacity: number
}

interface ControlLoopStatus {
  active: boolean
  current_target?: number
  current_sent?: number
  current_retries?: number
  scaling_used?: boolean
}

export function ControlLoopEnforcerDashboard() {
  const [target, setTarget] = useState(50000)
  const [campaignId, setCampaignId] = useState('')
  const [isExecuting, setIsExecuting] = useState(false)
  const [result, setResult] = useState<ControlLoopResult | null>(null)
  const [status, setStatus] = useState<ControlLoopStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)

  // Fetch status on mount and periodically
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/control-loop/execute')
        if (res.ok) {
          const data = await res.json()
          setStatus(data.status)
        }
      } catch (err) {
        console.error('Failed to fetch status:', err)
      }
    }

    fetchStatus()
    const interval = setInterval(fetchStatus, 5000) // Every 5 seconds
    return () => clearInterval(interval)
  }, [])

  const handleExecute = async () => {
    if (!campaignId.trim()) {
      setError('Campaign ID is required')
      return
    }

    setIsExecuting(true)
    setError(null)
    setResult(null)
    setProgress(0)

    try {
      const res = await fetch('/api/control-loop/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: parseInt(target.toString(), 10),
          campaignId: campaignId.trim(),
        }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Execution failed')
      }

      const data = await res.json()
      setResult(data.result)

      // Simulate progress updates (in real implementation, this would come from the API)
      const progressInterval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 95) {
            clearInterval(progressInterval)
            return 100
          }
          return prev + Math.random() * 10
        })
      }, 1000)

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsExecuting(false)
      setProgress(100)
    }
  }

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`
    } else {
      return `${seconds}s`
    }
  }

  const getSuccessRate = () => {
    if (!result) return 0
    return Math.round((result.sent / result.target) * 100)
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Control Loop Enforcer</h1>
          <p className="text-gray-500 mt-1">
            Unbreakable email sending system - guarantees 50,000+ emails/day delivery
          </p>
        </div>
        <Badge variant="destructive" className="text-lg px-4 py-2">
          NEVER STOPS
        </Badge>
      </div>

      {/* Status Card */}
      <Card>
        <CardHeader>
          <CardTitle>System Status</CardTitle>
          <CardDescription>Current control loop enforcer status</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-medium">Status</Label>
              <div className="mt-1">
                {status?.active ? (
                  <Badge className="bg-green-500">ACTIVE</Badge>
                ) : (
                  <Badge variant="outline">IDLE</Badge>
                )}
              </div>
            </div>
            {status?.active && (
              <>
                <div>
                  <Label className="text-sm font-medium">Progress</Label>
                  <div className="mt-1">
                    {status.current_sent}/{status.current_target} emails
                  </div>
                </div>
                <div>
                  <Label className="text-sm font-medium">Retries</Label>
                  <div className="mt-1">{status.current_retries}</div>
                </div>
                <div>
                  <Label className="text-sm font-medium">Scaling</Label>
                  <div className="mt-1">
                    {status.scaling_used ? (
                      <Badge className="bg-blue-500">USED</Badge>
                    ) : (
                      <Badge variant="outline">NOT USED</Badge>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Execution Form */}
      <Card>
        <CardHeader>
          <CardTitle>Execute Control Loop</CardTitle>
          <CardDescription>
            Configure and start the unbreakable email sending system
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="target">Target Emails</Label>
              <Input
                id="target"
                type="number"
                value={target}
                onChange={(e) => setTarget(parseInt(e.target.value, 10) || 50000)}
                placeholder="50000"
                min="1"
                max="100000"
              />
              <p className="text-xs text-gray-500 mt-1">
                Minimum guaranteed delivery (system will exceed if possible)
              </p>
            </div>
            <div>
              <Label htmlFor="campaignId">Campaign ID</Label>
              <Input
                id="campaignId"
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
                placeholder="Enter campaign ID"
              />
              <p className="text-xs text-gray-500 mt-1">
                Campaign containing emails to send
              </p>
            </div>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button
            onClick={handleExecute}
            disabled={isExecuting}
            className="w-full"
            size="lg"
          >
            {isExecuting ? 'EXECUTING CONTROL LOOP...' : 'START CONTROL LOOP ENFORCER'}
          </Button>

          {isExecuting && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Progress</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="w-full" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Execution Results</CardTitle>
            <CardDescription>Control loop enforcer completion report</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-3xl font-bold text-blue-600">{result.sent.toLocaleString()}</div>
                <p className="text-sm text-gray-500">Emails Sent</p>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-green-600">{result.target.toLocaleString()}</div>
                <p className="text-sm text-gray-500">Target</p>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-purple-600">{getSuccessRate()}%</div>
                <p className="text-sm text-gray-500">Success Rate</p>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-orange-600">{result.retries.toLocaleString()}</div>
                <p className="text-sm text-gray-500">Retries</p>
              </div>
            </div>

            <Separator />

            {/* Details */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Status</Label>
                <div className="mt-1">
                  <Badge
                    className={
                      result.status === 'completed'
                        ? 'bg-green-500'
                        : 'bg-yellow-500'
                    }
                  >
                    {result.status === 'completed' ? 'COMPLETED' : 'FORCED COMPLETION'}
                  </Badge>
                </div>
              </div>
              <div>
                <Label className="text-sm font-medium">Duration</Label>
                <div className="mt-1">{formatDuration(result.duration_ms)}</div>
              </div>
              <div>
                <Label className="text-sm font-medium">Scaling Used</Label>
                <div className="mt-1">
                  {result.scaling_used ? (
                    <Badge className="bg-blue-500">YES</Badge>
                  ) : (
                    <Badge variant="outline">NO</Badge>
                  )}
                </div>
              </div>
              <div>
                <Label className="text-sm font-medium">Final Capacity</Label>
                <div className="mt-1">{result.final_capacity.toLocaleString()} emails/day</div>
              </div>
            </div>

            <Separator />

            {/* Timeline */}
            <div>
              <Label className="text-sm font-medium">Execution Timeline</Label>
              <div className="mt-2 space-y-1 text-sm">
                <div>Started: {new Date(result.start_time).toLocaleString()}</div>
                <div>Completed: {new Date(result.end_time).toLocaleString()}</div>
                <div>Buffer Capacity: {result.buffer_capacity.toLocaleString()} emails</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Rules Reminder */}
      <Alert>
        <AlertDescription>
          <strong>STRICT RULES:</strong> This system NEVER exits early, NEVER skips emails,
          ALWAYS retries until success, ALWAYS scales instead of stopping, and maintains
          20-30% buffer capacity. If stuck, it triggers emergency scaling and continues.
        </AlertDescription>
      </Alert>
    </div>
  )
}
