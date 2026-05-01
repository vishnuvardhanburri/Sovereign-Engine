import Link from 'next/link'
import {
  BadgeCheck,
  ClipboardCheck,
  FileCheck2,
  KeyRound,
  LockKeyhole,
  RadioTower,
  Scale,
  ShieldCheck,
  Siren,
  Sparkles,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const trustPillars = [
  {
    title: 'Compliance-First Delivery',
    detail: 'Built around SPF, DKIM, DMARC, suppression, consent-aware imports, and provider-safe ramping.',
    icon: Scale,
  },
  {
    title: 'Production Gate',
    detail: 'Real sending stays locked until domains, SMTP/ESP credentials, secrets, DNS, and compliance inputs are present.',
    icon: LockKeyhole,
  },
  {
    title: 'Tamper-Evident Audit',
    detail: 'Privileged actions are written as append-only events with chain hashes for diligence and incident review.',
    icon: FileCheck2,
  },
  {
    title: 'Live Health Oracle',
    detail: 'Postgres, Redis, BullMQ, worker heartbeats, queue pressure, and latency are exposed for buyer proof.',
    icon: RadioTower,
  },
  {
    title: 'Tenant-Safe Architecture',
    detail: 'Client-aware state, suppression, reputation lanes, and RLS scripts support clean multi-tenant operations.',
    icon: ShieldCheck,
  },
  {
    title: 'Mock-Safe Scale Proof',
    detail: 'Stress tests and demo imports prove the pipeline without sending real email or using real prospect data.',
    icon: Sparkles,
  },
]

const safeLanguage = [
  'Adaptive deliverability operating system',
  'Provider-aware reputation control',
  'Safe ramping and emergency braking',
  'Compliance-first outbound infrastructure',
  'Due-diligence-ready audit and health proof',
]

const avoidLanguage = [
  'Any promise that every message lands in the inbox',
  'Claims that provider policies can be ignored',
  'Hidden sending identity or unclear ownership',
  'Unverified contact blasting',
  'Messaging that skips consent, suppression, or unsubscribe controls',
]

const platformHandles = [
  'Database schema, queues, dashboards, workers, audit logs, health checks, and mock stress proof.',
  'Provider-lane controls for Gmail, Outlook, Yahoo, and iCloud.',
  'Buyer handoff ZIP, due-diligence PDF, setup report, and production gate JSON.',
]

const buyerSupplies = [
  'Buyer-owned domains, DNS access, legal sending identity, and public dashboard host.',
  'SMTP/ESP credentials, validation provider key, production secrets, and HTTPS.',
  'Consent-aware contact source, suppression list, unsubscribe policy, and legal address where required.',
]

export default function TrustCenterPage() {
  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-3xl border border-emerald-500/15 bg-[radial-gradient(circle_at_top_right,_rgba(16,185,129,0.18),_transparent_34%),radial-gradient(circle_at_bottom_left,_rgba(14,165,233,0.16),_transparent_30%),linear-gradient(135deg,_hsl(var(--card)),_hsl(var(--background)))] p-6 shadow-sm">
        <Badge variant="outline" className="mb-3 border-emerald-500/25 bg-emerald-500/10 text-emerald-600">
          <BadgeCheck className="mr-1 h-3.5 w-3.5" />
          Trust center
        </Badge>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Enterprise Trust Center</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              The buyer-safe proof surface for Sovereign Engine: what is production-ready, what stays gated, what
              the client must connect, and what claims the product intentionally avoids.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a href="/api/trust/summary?domain=sovereign-demo.example" target="_blank" rel="noreferrer">
                <ClipboardCheck className="mr-2 h-4 w-4" />
                Trust JSON
              </a>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/proof">Open Proof Board</Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {trustPillars.map((pillar) => {
          const Icon = pillar.icon
          return (
            <Card key={pillar.title} className="overflow-hidden">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <span className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-2 text-emerald-500">
                    <Icon className="h-4 w-4" />
                  </span>
                  {pillar.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{pillar.detail}</CardContent>
            </Card>
          )
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-500" />
              Say This In Buyer Calls
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {safeLanguage.map((item) => (
              <div key={item} className="flex gap-2 rounded-2xl border border-emerald-500/15 bg-emerald-500/5 p-3 text-sm">
                <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                {item}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Siren className="h-5 w-5 text-amber-500" />
              Do Not Claim
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {avoidLanguage.map((item) => (
              <div key={item} className="flex gap-2 rounded-2xl border border-amber-500/15 bg-amber-500/5 p-3 text-sm">
                <Siren className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                {item}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-cyan-500" />
              Platform Already Handles
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {platformHandles.map((item) => (
              <div key={item} className="rounded-2xl border p-3 text-sm text-muted-foreground">{item}</div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-violet-500" />
              Buyer Connects After Handoff
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {buyerSupplies.map((item) => (
              <div key={item} className="rounded-2xl border p-3 text-sm text-muted-foreground">{item}</div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
