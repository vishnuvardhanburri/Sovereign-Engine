# Buyer FAQ

## What is Sovereign Engine?

Sovereign Engine is a Deliverability Operating System: outbound revenue protection infrastructure for teams that rely on healthy domains, controlled queues, and provider-aware reputation monitoring.

## Who is the buyer?

Ideal buyers are outbound SaaS teams, agencies, growth infrastructure companies, RevOps tooling companies, and technical operators who want to add deliverability control-plane infrastructure to an existing distribution channel.

## Is there revenue?

No revenue is claimed. Pricing and ROI views are monetization signals only.

## Are the metrics real?

The proof metrics are simulated and clearly labeled. The system generates seeded 10,000-event proof data to demonstrate architecture, queue flow, reputation scoring, and buyer diligence readiness.

## Why could this be worth a $125K acquisition ask?

The value is in saved build time, working infrastructure, technical breadth, acquisition packaging, and a clear market narrative: protecting outbound revenue before domain reputation damage becomes expensive. The product is priced as premium infrastructure with Starter at $1,499/mo, Growth at $4,999/mo, and Enterprise from $12,000/mo.

## What is included?

The repo, Docker production stack, command center, reputation APIs, queue/worker proof, health oracle, pricing page, license-validation demo endpoint, API-key endpoint, data-room generator, launch-ready script, and acquisition docs.

## What does a buyer still need?

Buyer-owned domains, DNS access, SMTP/ESP credentials, production secrets, compliance policy, suppression policy, and customer distribution.

## Does it guarantee inbox placement?

No. It provides controls, monitoring, safe-ramp logic, and operational visibility. It does not promise guaranteed inbox placement.

## How do I run the proof?

```bash
pnpm launch:ready
```

Then open:

```text
http://localhost:3400/login
demo@sovereign.local
Demo1234!
```

## How do I generate the data room?

```bash
pnpm generate:data-room
```
