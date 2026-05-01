'use client'

import { useQuery } from '@tanstack/react-query'
import { BadgeCheck, CircleAlert, FlaskConical } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

type Readiness = {
  status: 'READY' | 'NEEDS_ATTENTION' | 'BLOCKED'
  score: number
  nextActions?: string[]
}

async function fetchReadiness(): Promise<Readiness> {
  const response = await fetch('/api/setup/readiness?domain=sovereign-demo.example', { cache: 'no-store' })
  if (!response.ok) throw new Error('Failed to load readiness')
  return response.json()
}

function labelFor(readiness?: Readiness) {
  if (!readiness) return { label: 'Checking', tone: 'border-white/10 bg-white/5 text-slate-200', icon: FlaskConical }
  if (readiness.status === 'READY') {
    return { label: 'Production Ready', tone: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200', icon: BadgeCheck }
  }
  const actions = (readiness.nextActions ?? []).join(' ').toLowerCase()
  if (actions.includes('smtp')) return { label: 'Needs SMTP', tone: 'border-amber-500/25 bg-amber-500/10 text-amber-200', icon: CircleAlert }
  if (actions.includes('dns') || actions.includes('spf') || actions.includes('dkim') || actions.includes('dmarc')) {
    return { label: 'Needs DNS', tone: 'border-amber-500/25 bg-amber-500/10 text-amber-200', icon: CircleAlert }
  }
  if (actions.includes('zerobounce') || actions.includes('validator')) {
    return { label: 'Needs Validator', tone: 'border-amber-500/25 bg-amber-500/10 text-amber-200', icon: CircleAlert }
  }
  if (readiness.score >= 70) return { label: 'Demo Ready', tone: 'border-cyan-500/25 bg-cyan-500/10 text-cyan-200', icon: FlaskConical }
  return { label: 'Needs Setup', tone: 'border-red-500/25 bg-red-500/10 text-red-200', icon: CircleAlert }
}

export function ProductionReadinessBadge() {
  const readiness = useQuery({
    queryKey: ['production-readiness-badge'],
    queryFn: fetchReadiness,
    refetchInterval: 60_000,
    retry: 1,
  })
  const badge = labelFor(readiness.data)
  const Icon = badge.icon

  return (
    <Badge variant="outline" className={`gap-1.5 ${badge.tone}`}>
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden lg:inline">{badge.label}</span>
      <span className="lg:hidden">{readiness.data?.score ?? '--'}</span>
    </Badge>
  )
}
