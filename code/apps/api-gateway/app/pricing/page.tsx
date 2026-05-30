import { CheckCircle2, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react'
import { XAVIRA_COMMERCIAL_MODEL } from '@/lib/commercial-model'

const plans = [
  {
    name: XAVIRA_COMMERCIAL_MODEL.internalEnterpriseLicense.name,
    price: XAVIRA_COMMERCIAL_MODEL.internalEnterpriseLicense.label,
    description:
      'For companies operating Xavira Control Stack inside their own organization as enterprise communication operations infrastructure.',
    features: [
      'Sovereign Engine',
      'Sovereign Shield',
      'Autonomous Communication OS',
      'Web Dashboard, Desktop Console, and Mobile Console',
      'Deployment assistance',
      'Internal operational usage rights',
      'No reseller, white-label, or commercial redistribution rights',
    ],
  },
  {
    name: XAVIRA_COMMERCIAL_MODEL.whiteLabelCommercialLicense.name,
    price: XAVIRA_COMMERCIAL_MODEL.whiteLabelCommercialLicense.label,
    description:
      'For agencies, consultancies, MSSPs, and operators that want commercial deployment rights across their own client base.',
    features: [
      'White-label rights',
      'Reseller rights',
      'Commercial deployment rights',
      'Multi-client operations',
      'Branding customization rights',
      'Commercial usage rights',
      'Infrastructure deployment assistance',
      'Partner economics: package client deployments so 3-4 serious wins can recover the license cost',
    ],
    featured: true,
  },
  {
    name: XAVIRA_COMMERCIAL_MODEL.operationsMaintenance.name,
    price: XAVIRA_COMMERCIAL_MODEL.operationsMaintenance.label,
    description:
      'Ongoing operations support for licensed deployments that need updates, monitoring assistance, and governance guidance.',
    features: [
      'Technical support',
      'Platform updates',
      'Infrastructure guidance',
      'Operational assistance',
      'Monitoring support',
      'Governance support',
      'Billed monthly in GBP',
    ],
  },
]

const platformIncludes = [
  'Enterprise Communication Operations Platform combining Sovereign Engine and Sovereign Shield.',
  'Communication governance infrastructure for outbound reliability, AI governance, and audit evidence.',
  'Operational intelligence dashboards for delivery proof, queue state, worker health, and risk visibility.',
  'Provider-aware orchestration and internal control surfaces for web, desktop, and mobile operations.',
  'Deployment assistance for operator-owned domains, secrets, DNS, suppression policy, and production controls.',
]

const operatorConnects = [
  'Operator-owned sending domains, DNS records, legal sender identity, and HTTPS host.',
  'SMTP/ESP credentials, API keys, production secrets, and provider quotas.',
  'Consent-aware contact sources, suppression list, unsubscribe policy, and compliance process.',
  'Warmup/reputation policy appropriate for the operator’s domains and sending history.',
]

export const metadata = {
  title: 'Pricing | Xavira Control Stack',
  description:
    'Final GBP licensing for Xavira Control Stack: enterprise communication operations and AI governance infrastructure.',
}

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="max-w-3xl">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-200">
            <ShieldCheck size={16} /> Enterprise Communication Operations Platform
          </div>
          <h1 className="text-4xl font-black tracking-tight md:text-6xl">
            Xavira Control Stack is licensed as enterprise infrastructure.
          </h1>
          <p className="mt-5 text-lg leading-8 text-slate-300">
            Sovereign Engine and Sovereign Shield combine into a communication governance,
            operational intelligence, and infrastructure control system for teams that need
            trust, auditability, and deployment control.
          </p>
          <p className="mt-4 text-sm font-semibold uppercase tracking-[0.22em] text-cyan-200">
            All invoices are issued in GBP. Global buyers pay the GBP equivalent.
          </p>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-2xl border p-7 ${
                plan.featured ? 'border-cyan-300 bg-cyan-400/10' : 'border-white/10 bg-white/[0.03]'
              }`}
            >
              <h2 className="text-2xl font-black">{plan.name}</h2>
              <p className="mt-2 min-h-20 text-sm text-slate-400">{plan.description}</p>
              <div className="mt-7 text-4xl font-black text-cyan-200">{plan.price}</div>
              <ul className="mt-7 space-y-3 text-sm text-slate-200">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-3">
                    <CheckCircle2 className="mt-0.5 shrink-0 text-cyan-300" size={16} />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="mt-8 text-sm text-slate-500">
          Pricing reflects infrastructure licensing, operational tooling, deployment support,
          governance controls, and commercial rights. Xavira Control Stack is not sold as bulk
          email software, a cold email tool, or a lead-generation platform.
        </p>

        <div className="mt-8 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-6">
          <div className="text-sm font-bold uppercase tracking-[0.22em] text-cyan-200">
            White-label partner economics
          </div>
          <h2 className="mt-3 text-2xl font-black">
            The commercial license is built to become an agency revenue asset.
          </h2>
          <p className="mt-3 max-w-4xl text-sm leading-7 text-slate-300">
            A licensed partner can package Xavira Control Stack as a premium client deployment:
            outbound governance, deliverability operations, AI safety controls, proof dashboards,
            and ongoing operational support under their own brand. The £100,000 GBP license is
            designed so roughly 3-4 serious client rollouts can recover the license cost, then
            every additional client deployment compounds on the same infrastructure base.
          </p>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-2">
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-6">
            <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.22em] text-emerald-200">
              <ShieldCheck size={16} /> Included Infrastructure
            </div>
            <ul className="mt-5 space-y-3 text-sm text-slate-200">
              {platformIncludes.map((item) => (
                <li key={item} className="flex gap-3">
                  <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-300" size={16} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-6">
            <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.22em] text-amber-200">
              <KeyRound size={16} /> Operator Connects
            </div>
            <ul className="mt-5 space-y-3 text-sm text-slate-200">
              {operatorConnects.map((item) => (
                <li key={item} className="flex gap-3">
                  <LockKeyhole className="mt-0.5 shrink-0 text-amber-300" size={16} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </main>
  )
}
