'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { useCampaigns } from '@/lib/hooks'
import { CheckCircle2, CircleDashed, Loader2, Mail, Globe, Flame, Rocket } from 'lucide-react'

type ItemStatus = 'pending' | 'in_progress' | 'complete'

function statusTone(s: ItemStatus): string {
  if (s === 'complete') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
  if (s === 'in_progress') return 'border-amber-500/30 bg-amber-500/10 text-amber-200'
  return 'border-white/10 bg-black/10 text-muted-foreground'
}

function iconFor(name: string) {
  if (name.includes('Domains')) return Globe
  if (name.includes('Inboxes')) return Mail
  if (name.includes('Warmup')) return Flame
  return Rocket
}

async function fetchJson(url: string) {
  const res = await fetch(url)
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
  return json
}

export function OnboardingChecklist() {
  const { data: campaigns } = useCampaigns()
  const [domains, setDomains] = useState<any[] | null>(null)
  const [identitiesCount, setIdentitiesCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let mounted = true
    const load = async () => {
      setLoading(true)
      try {
        const d = await fetchJson('/api/domains')
        if (!mounted) return
        setDomains(Array.isArray(d) ? d : [])

        // identities endpoint needs domain_id, so sample across domains.
        let total = 0
        if (Array.isArray(d)) {
          for (const dom of d.slice(0, 12)) {
            if (!dom?.id) continue
            const rows = await fetchJson(`/api/identities?domain_id=${dom.id}&page=1&limit=1`).catch(() => [])
            if (Array.isArray(rows) && rows.length > 0) total += 1
          }
        }
        if (!mounted) return
        setIdentitiesCount(total)
      } catch {
        if (!mounted) return
        setDomains([])
        setIdentitiesCount(0)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    load()
    const id = window.setInterval(load, 20000)
    return () => {
      mounted = false
      window.clearInterval(id)
    }
  }, [])

  const activeCampaigns = useMemo(() => (campaigns ?? []).filter((c) => c.status === 'active'), [campaigns])
  const domainsConfigured = (domains?.length ?? 0) > 0
  const inboxesConnected = (identitiesCount ?? 0) > 0
  const warmupActive = domainsConfigured && inboxesConnected
  const campaignLive = activeCampaigns.length > 0

  const items = useMemo(
    () =>
      [
        {
          name: 'Domains configured',
          status: domainsConfigured ? 'complete' : 'pending',
          hint: domainsConfigured ? `${domains?.length ?? 0} domain(s)` : 'Add at least 1 domain',
        },
        {
          name: 'Inboxes connected',
          status: inboxesConnected ? 'complete' : domainsConfigured ? 'in_progress' : 'pending',
          hint: inboxesConnected ? `${identitiesCount ?? 0}+ inbox(es)` : 'Connect inboxes to start sending',
        },
        {
          name: 'Warmup active',
          status: warmupActive ? 'complete' : inboxesConnected ? 'in_progress' : 'pending',
          hint: warmupActive ? 'Warming and ramping safely' : 'Warmup starts after inbox connect',
        },
        {
          name: 'Campaign live',
          status: campaignLive ? 'complete' : warmupActive ? 'in_progress' : 'pending',
          hint: campaignLive ? `${activeCampaigns.length} active` : 'Launch a campaign',
        },
      ] as Array<{ name: string; status: ItemStatus; hint: string }>,
    [domainsConfigured, domains, inboxesConnected, identitiesCount, warmupActive, campaignLive, activeCampaigns.length],
  )

  const completed = items.filter((i) => i.status === 'complete').length
  const progress = Math.round((completed / items.length) * 100)

  return (
    <Card className="bg-white/5 backdrop-blur border-white/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span>Onboarding Checklist</span>
          {loading ? <Loader2 className="h-4 w-4 animate-spin opacity-70" /> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Setup progress</span>
            <span>{progress}%</span>
          </div>
          <Progress value={progress} className="h-2 bg-black/20" />
        </div>

        <div className="space-y-2">
          {items.map((it) => {
            const Icon = iconFor(it.name)
            const DoneIcon = it.status === 'complete' ? CheckCircle2 : CircleDashed
            return (
              <div key={it.name} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-8 w-8 rounded-md bg-white/5 border border-white/10 flex items-center justify-center">
                    <Icon className="h-4 w-4 opacity-80" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{it.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{it.hint}</div>
                  </div>
                </div>
                <Badge variant="outline" className={statusTone(it.status)}>
                  <DoneIcon className="h-3.5 w-3.5 mr-1 opacity-80" />
                  {it.status.replace('_', ' ')}
                </Badge>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

