'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, ClipboardCheck, Copy, Download, Globe2, RefreshCw, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'

type CheckStatus = 'pass' | 'warn' | 'fail' | 'info'

type ReadinessCheck = {
  id: string
  label: string
  status: CheckStatus
  detail: string
  evidence?: string[]
  suggestedRecord?: {
    type: 'TXT' | 'CNAME' | 'MX'
    host: string
    value: string
    priority?: number
    note?: string
  }
  action?: string
}

type ReadinessSection = {
  id: string
  title: string
  summary: string
  checks: ReadinessCheck[]
}

type ReadinessResponse = {
  ok: boolean
  generatedAt: string
  domain: string | null
  smtpHost: string | null
  score: number
  status: 'READY' | 'NEEDS_ATTENTION' | 'BLOCKED'
  blockers: number
  warnings: number
  sections: ReadinessSection[]
  nextActions: string[]
}

function statusClass(status: CheckStatus) {
  if (status === 'pass') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600'
  if (status === 'fail') return 'border-red-500/20 bg-red-500/10 text-red-600'
  if (status === 'warn') return 'border-amber-500/20 bg-amber-500/10 text-amber-600'
  return 'border-sky-500/20 bg-sky-500/10 text-sky-600'
}

function statusIcon(status: CheckStatus) {
  if (status === 'pass') return <CheckCircle2 className="h-4 w-4 text-emerald-500" />
  if (status === 'fail') return <AlertTriangle className="h-4 w-4 text-red-500" />
  if (status === 'warn') return <AlertTriangle className="h-4 w-4 text-amber-500" />
  return <ShieldCheck className="h-4 w-4 text-sky-500" />
}

async function fetchReadiness(domain: string, smtpHost: string): Promise<ReadinessResponse> {
  const params = new URLSearchParams()
  if (domain.trim()) params.set('domain', domain.trim())
  if (smtpHost.trim()) params.set('smtp_host', smtpHost.trim())
  const response = await fetch(`/api/setup/readiness?${params.toString()}`, { cache: 'no-store' })
  if (!response.ok) throw new Error('Failed to load readiness')
  return response.json()
}

export default function SetupWizardPage() {
  const [domain, setDomain] = useState('')
  const [smtpHost, setSmtpHost] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const readiness = useQuery({
    queryKey: ['setup-readiness', domain, smtpHost],
    queryFn: () => fetchReadiness(domain, smtpHost),
    refetchInterval: 60_000,
  })

  const reportUrl = useMemo(() => {
    const params = new URLSearchParams()
    if (domain.trim()) params.set('domain', domain.trim())
    if (smtpHost.trim()) params.set('smtp_host', smtpHost.trim())
    return `/api/setup/report?${params.toString()}`
  }, [domain, smtpHost])

  const data = readiness.data

  async function copySuggestedRecord(item: ReadinessCheck) {
    if (!item.suggestedRecord) return
    const record = item.suggestedRecord
    const text = [
      `Type: ${record.type}`,
      `Host: ${record.host}`,
      record.priority ? `Priority: ${record.priority}` : null,
      `Value: ${record.value}`,
      record.note ? `Note: ${record.note}` : null,
    ]
      .filter(Boolean)
      .join('\n')
    await navigator.clipboard.writeText(text)
    setCopiedId(item.id)
    window.setTimeout(() => setCopiedId((current) => (current === item.id ? null : current)), 1800)
  }

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-3xl border bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_35%),linear-gradient(135deg,_hsl(var(--card)),_hsl(var(--background)))] p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Badge variant="outline" className="mb-3 border-cyan-500/20 bg-cyan-500/10 text-cyan-600">
              <ClipboardCheck className="mr-1 h-3 w-3" />
              Buyer setup wizard
            </Badge>
            <h1 className="text-3xl font-semibold tracking-tight">Production Readiness Center</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Verify DNS, app secrets, SMTP readiness, and compliance controls before a buyer turns on real traffic.
              The system stays demo-safe until production credentials and authenticated domains are connected.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => readiness.refetch()} disabled={readiness.isFetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${readiness.isFetching ? 'animate-spin' : ''}`} />
              Re-run checks
            </Button>
            <Button asChild>
              <a href={reportUrl} target="_blank" rel="noreferrer">
                <Download className="mr-2 h-4 w-4" />
                Open report
              </a>
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>Onboarding Inputs</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Sending domain</label>
              <Input placeholder="example.com" value={domain} onChange={(event) => setDomain(event.target.value)} />
              <p className="text-xs text-muted-foreground">Use the domain that will publish SPF, DKIM, DMARC, and MTA-STS.</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">SMTP / ESP host</label>
              <Input placeholder="smtp.provider.com" value={smtpHost} onChange={(event) => setSmtpHost(event.target.value)} />
              <p className="text-xs text-muted-foreground">Optional: overrides SMTP_HOST for this readiness check only.</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Readiness Score</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-end justify-between">
              <div className="text-5xl font-semibold tracking-tighter">{data?.score ?? '--'}</div>
              <Badge
                variant="outline"
                className={
                  data?.status === 'READY'
                    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600'
                    : data?.status === 'BLOCKED'
                      ? 'border-red-500/20 bg-red-500/10 text-red-600'
                      : 'border-amber-500/20 bg-amber-500/10 text-amber-600'
                }
              >
                {data?.status ?? 'CHECKING'}
              </Badge>
            </div>
            <Progress value={data?.score ?? 0} />
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border p-3">
                <div className="font-semibold">{data?.blockers ?? 0}</div>
                <div className="text-muted-foreground">Blockers</div>
              </div>
              <div className="rounded-xl border p-3">
                <div className="font-semibold">{data?.warnings ?? 0}</div>
                <div className="text-muted-foreground">Warnings</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4">
        {(data?.sections ?? []).map((section) => (
          <Card key={section.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {section.id === 'dns' ? <Globe2 className="h-5 w-5 text-cyan-500" /> : <ShieldCheck className="h-5 w-5 text-emerald-500" />}
                {section.title}
              </CardTitle>
              <p className="text-sm text-muted-foreground">{section.summary}</p>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {section.checks.map((item) => (
                <div key={item.id} className="rounded-2xl border p-4">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      {statusIcon(item.status)}
                      <div className="font-medium">{item.label}</div>
                    </div>
                    <Badge variant="outline" className={statusClass(item.status)}>
                      {item.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{item.detail}</p>
                  {item.evidence?.length ? (
                    <div className="mt-3 rounded-xl bg-muted p-3 text-xs text-muted-foreground">
                      {item.evidence.slice(0, 3).map((evidence) => (
                        <div key={evidence} className="truncate">{evidence}</div>
                      ))}
                    </div>
                  ) : null}
                  {item.suggestedRecord ? (
                    <div className="mt-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-cyan-500">
                          Suggested DNS record
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 px-2 text-xs"
                          onClick={() => copySuggestedRecord(item)}
                        >
                          <Copy className="h-3 w-3" />
                          {copiedId === item.id ? 'Copied' : 'Copy'}
                        </Button>
                      </div>
                      <div className="grid gap-2 text-xs">
                        <div className="grid grid-cols-[72px_1fr] gap-2">
                          <span className="text-muted-foreground">Type</span>
                          <span className="font-mono">{item.suggestedRecord.type}</span>
                        </div>
                        <div className="grid grid-cols-[72px_1fr] gap-2">
                          <span className="text-muted-foreground">Host</span>
                          <span className="break-all font-mono">{item.suggestedRecord.host}</span>
                        </div>
                        {item.suggestedRecord.priority ? (
                          <div className="grid grid-cols-[72px_1fr] gap-2">
                            <span className="text-muted-foreground">Priority</span>
                            <span className="font-mono">{item.suggestedRecord.priority}</span>
                          </div>
                        ) : null}
                        <div className="grid grid-cols-[72px_1fr] gap-2">
                          <span className="text-muted-foreground">Value</span>
                          <span className="break-all font-mono">{item.suggestedRecord.value}</span>
                        </div>
                      </div>
                      {item.suggestedRecord.note ? (
                        <p className="mt-2 text-xs text-muted-foreground">{item.suggestedRecord.note}</p>
                      ) : null}
                    </div>
                  ) : null}
                  {item.action ? <p className="mt-3 text-xs font-medium text-foreground">{item.action}</p> : null}
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
