import { CheckCircle2, ShieldCheck } from 'lucide-react'

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
      </section>
    </main>
  )
}
