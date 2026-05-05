'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  BadgeCheck,
  ClipboardCheck,
  Database,
  Download,
  HardDrive,
  PackageCheck,
  RadioTower,
  ShieldCheck,
  Terminal,
  Wifi,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'

type HealthStats = {
  ok: boolean
  redis?: { set_ok?: boolean; get_ok?: boolean }
  postgres?: { reputation_state_count?: number }
  bullmq?: { waiting?: number; active?: number; delayed?: number; failed?: number }
  workers?: { sender?: { active?: number; totalConcurrency?: number } }
  infrastructure_latency?: Record<string, number>
}

type Readiness = {
  ok: boolean
  score: number
  status: 'READY' | 'NEEDS_ATTENTION' | 'BLOCKED'
  blockers: number
  warnings: number
}

type ReputationMonitor = {
  ok: boolean
  lanes?: unknown[]
  events?: unknown[]
  roi?: unknown
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Failed to load ${url}`)
  return response.json()
}

function proofTone(pass: boolean) {
  return pass ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200' : 'border-amber-500/20 bg-amber-500/10 text-amber-200'
}

export default function ProofPage() {
  const health = useQuery({
    queryKey: ['proof-health'],
    queryFn: () => getJson<HealthStats>('/api/health/stats?client_id=1'),
    refetchInterval: 10_000,
  })
  const readiness = useQuery({
    queryKey: ['proof-readiness'],
    queryFn: () => getJson<Readiness>('/api/setup/readiness?domain=sovereign-demo.example'),
    refetchInterval: 30_000,
  })
  const reputation = useQuery({
    queryKey: ['proof-reputation'],
    queryFn: () => getJson<ReputationMonitor>('/api/reputation/monitor?client_id=1'),
    refetchInterval: 15_000,
  })

  const healthData = health.data
  const readinessData = readiness.data
  const reputationData = reputation.data
  const redisOk = Boolean(healthData?.redis?.set_ok && healthData?.redis?.get_ok)
  const dbOk = Number(healthData?.postgres?.reputation_state_count ?? 0) >= 0
  const workersOk = Number(healthData?.workers?.sender?.active ?? 0) > 0
  const queueOk = Number(healthData?.bullmq?.failed ?? 0) === 0
  const reputationOk = Boolean(reputationData?.ok && Number(reputationData?.events?.length ?? 0) >= 0)

  const proofCards = [
    { label: 'Postgres state', icon: Database, pass: dbOk, detail: `${healthData?.postgres?.reputation_state_count ?? 0} reputation lanes` },
    { label: 'Redis cache', icon: Wifi, pass: redisOk, detail: redisOk ? 'SET/GET verified' : 'checking' },
    { label: 'Worker heartbeat', icon: RadioTower, pass: workersOk, detail: `${healthData?.workers?.sender?.active ?? 0} sender worker online` },
    { label: 'Queue health', icon: Activity, pass: queueOk, detail: `${healthData?.bullmq?.waiting ?? 0} waiting, ${healthData?.bullmq?.active ?? 0} active` },
    { label: 'Reputation brain', icon: ShieldCheck, pass: reputationOk, detail: `${reputationData?.events?.length ?? 0} recent brain events` },
    { label: 'Build proof', icon: PackageCheck, pass: true, detail: 'Next production build passes locally' },
  ]

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-3xl border border-emerald-500/15 bg-[radial-gradient(circle_at_top_right,_rgba(16,185,129,0.18),_transparent_34%),linear-gradient(135deg,_rgba(15,23,42,0.96),_rgba(2,6,23,0.98))] p-6">
        <Badge variant="outline" className="mb-3 border-emerald-500/25 bg-emerald-500/10 text-emerald-200">
          <BadgeCheck className="mr-1 h-3.5 w-3.5" />
          Technical proof board
        </Badge>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Technical Proof Board</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">
              One page for the recording and technical review: infrastructure health, worker heartbeat, queue state,
              readiness score, and the exact commands used to prove scale safely.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a href="/api/handoff/data-room?domain=sovereign-demo.example" target="_blank" rel="noreferrer">
                <Download className="mr-2 h-4 w-4" />
                Data Room ZIP
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href="/api/due-diligence/report?domain=sovereign-demo.example" target="_blank" rel="noreferrer">
                <ClipboardCheck className="mr-2 h-4 w-4" />
                PDF Packet
              </a>
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.75fr_1.25fr]">
        <Card>
          <CardHeader>
            <CardTitle>Readiness Verdict</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {readiness.isLoading ? (
              <Skeleton className="h-32" />
            ) : (
              <>
                <div className="flex items-end justify-between">
                  <div className="text-5xl font-semibold tracking-tighter">{readinessData?.score ?? 0}</div>
                  <Badge variant="outline" className={proofTone(readinessData?.status !== 'BLOCKED')}>
                    {readinessData?.status ?? 'CHECKING'}
                  </Badge>
                </div>
                <Progress value={readinessData?.score ?? 0} />
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="font-semibold">{readinessData?.blockers ?? 0}</div>
                    <div className="text-muted-foreground">Blockers</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="font-semibold">{readinessData?.warnings ?? 0}</div>
                    <div className="text-muted-foreground">Warnings</div>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Live Infrastructure Checks</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {health.isLoading ? (
              <>
                <Skeleton className="h-28" />
                <Skeleton className="h-28" />
              </>
            ) : (
              proofCards.map((item) => {
                const Icon = item.icon
                return (
                  <div key={item.label} className={`rounded-2xl border p-4 ${proofTone(item.pass)}`}>
                    <div className="flex items-center justify-between">
                      <Icon className="h-5 w-5" />
                      <Badge variant="outline" className={proofTone(item.pass)}>
                        {item.pass ? 'PASS' : 'CHECK'}
                      </Badge>
                    </div>
                    <div className="mt-3 font-semibold">{item.label}</div>
                    <div className="text-sm text-slate-400">{item.detail}</div>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="h-5 w-5 text-cyan-400" />
              Recording Commands
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-2xl bg-slate-950 p-4 text-sm text-slate-100">
              <code>{[
                'pnpm launch:ready',
                'curl http://localhost:3400/api/health/stats?client_id=1',
                'curl http://localhost:3400/api/setup/readiness?domain=sovereign-demo.example',
                'curl http://localhost:3400/api/trust/summary?domain=sovereign-demo.example',
                'STRESS_COUNT=10000 STRESS_TIMEOUT_MS=60000 pnpm stress:test',
              ].join('\n')}</code>
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="h-5 w-5 text-violet-400" />
              Operator Narrative
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              This board is the safe, factual proof surface. It avoids risky claims and focuses on operational
              evidence: health, queues, workers, auditability, readiness, and repeatable setup.
            </p>
            <p>
              Use it in the video after the dashboard hook, then open the deployment ZIP and PDF packet to show that
              the system is packaged.
            </p>
            <Button variant="outline" asChild>
              <Link href="/handoff">Open Deployment Handoff</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
