import { AlertTriangle, CheckCircle2, KeyRound, Scale, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const productionInputs = [
  'Operator-owned sending domains with DNS access.',
  'Verified SMTP/ESP credentials and approved sender identities.',
  'Validation provider key for production imports.',
  'Consent-aware contact source, suppression list, unsubscribe policy, and legal address.',
  'Public dashboard domain with HTTPS and production secrets.',
]

const safeClaims = [
  'Provider-aware pacing and lane-level safety controls.',
  'Mock-safe stress proof without sending real email.',
  'Tamper-evident privileged-action audit trail.',
  'Health proof for Redis, Postgres, BullMQ, and worker heartbeats.',
  'Production gate that locks real sending until required inputs are connected.',
]

const notClaims = [
  'No promise that every message lands in the inbox.',
  'Provider policies remain mandatory for Gmail, Outlook, Yahoo, iCloud, and ESPs.',
  'No sending without lawful contacts and unsubscribe/suppression handling.',
  'No automatic creation of operator-owned DNS, SMTP, or legal business assets.',
]

export default function LimitsPage() {
  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-amber-500/15 bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.16),_transparent_34%),linear-gradient(135deg,_hsl(var(--card)),_hsl(var(--background)))] p-6">
        <Badge variant="outline" className="mb-3 border-amber-500/20 bg-amber-500/10 text-amber-500">
          <Scale className="mr-1 h-3.5 w-3.5" />
          Honest operating notes
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight">Known Limits & Production Gate</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          This page is designed for serious operators. It explains what the system can prove today, what must be supplied
          by the operator, and what claims Sovereign Engine intentionally does not make.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-amber-500" />
              Operator Inputs Required
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {productionInputs.map((item) => (
              <div key={item} className="flex gap-2 rounded-2xl border p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                {item}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-500" />
              Safe Claims
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {safeClaims.map((item) => (
              <div key={item} className="flex gap-2 rounded-2xl border p-3 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                {item}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Not Claimed
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {notClaims.map((item) => (
              <div key={item} className="flex gap-2 rounded-2xl border p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                {item}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
