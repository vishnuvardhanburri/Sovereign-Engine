import { CheckCircle2, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react'

const plans = [
  {
    name: 'Starter',
    price: '$1,499/mo',
    description: 'For serious outbound teams protecting early production sending infrastructure.',
    features: ['Up to 25k/day control-plane proof', 'Domain health monitoring', 'Reputation scoring', 'Queue visibility', 'Demo-safe API access'],
  },
  {
    name: 'Growth',
    price: '$4,999/mo',
    description: 'For teams operating 100k+/day outbound workflows across multiple domains.',
    features: ['Everything in Starter', '100k+/day infrastructure control plane', 'Worker health telemetry', 'Inbox placement simulation', 'Sending throttles', 'Reputation event logs'],
    featured: true,
  },
  {
    name: 'Enterprise',
    price: 'From $12,000/mo',
    description: 'For agencies and growth infrastructure companies treating deliverability as revenue infrastructure.',
    features: ['Everything in Growth', '250k+/day architecture planning', 'Custom sender topology', 'Dedicated warmup policy', 'Queue scaling proof', 'CTO handoff pack'],
  },
]

const platformIncludes = [
  'Command center for provider lanes, queue state, worker heartbeat, and reputation events.',
  'Postgres, Redis/BullMQ, sender-worker, reputation-worker, audit trail, and health oracle.',
  'Safe evaluation mode with 10,000-event mock proof and no external email traffic.',
  'Production gate that blocks real sending until required operator inputs are configured.',
]

const operatorConnects = [
  'Operator-owned sending domains, DNS records, legal sender identity, and HTTPS host.',
  'SMTP/ESP credentials, API keys, production secrets, and provider quotas.',
  'Consent-aware contact source, suppression list, unsubscribe policy, and compliance process.',
  'Warmup/reputation policy appropriate for the operator’s own domains and sending history.',
]

export const metadata = {
  title: 'Pricing | Sovereign Engine',
  description: 'Pricing for Sovereign Engine, a deliverability operating system for outbound revenue teams.',
}

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="max-w-3xl">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-200">
            <ShieldCheck size={16} /> Deliverability Operating System
          </div>
          <h1 className="text-4xl font-black tracking-tight md:text-6xl">
            Protect outbound revenue before domain reputation breaks.
          </h1>
          <p className="mt-5 text-lg leading-8 text-slate-300">
            Sovereign Engine gives outbound teams domain protection, inbox placement visibility,
            worker telemetry, and reputation control in one operating layer.
          </p>
        </div>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-2xl border p-7 ${plan.featured ? 'border-cyan-300 bg-cyan-400/10' : 'border-white/10 bg-white/[0.03]'}`}
            >
              <h2 className="text-2xl font-black">{plan.name}</h2>
              <p className="mt-2 min-h-14 text-sm text-slate-400">{plan.description}</p>
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
          Pricing reflects an enterprise infrastructure layer, not commodity email volume. Real 100k+/day sending depends on operator-owned domains, ESP quotas, DNS, compliance policy, and warmup strategy. No revenue claims are implied.
        </p>

        <div className="mt-12 grid gap-5 md:grid-cols-2">
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-6">
            <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.22em] text-emerald-200">
              <ShieldCheck size={16} /> Included in Sovereign Engine
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
