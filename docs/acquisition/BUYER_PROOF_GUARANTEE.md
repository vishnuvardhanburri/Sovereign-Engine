# Buyer Proof Guarantee

This is the exact guarantee that should be made during demos and evaluation.

## What We Can Guarantee

Sovereign Engine includes a repeatable proof process:

- `pnpm launch:ready` stands up the mock-safe system and validates key endpoints.
- `pnpm generate:data-room` creates a shareable data-room ZIP.
- `/demo/metrics` exposes clearly labeled synthetic 10,000-event proof data.
- `/api/health/stats` proves DB, Redis, queue, and worker visibility.
- `/api/production/gate` confirms real sending is locked until operator inputs are connected.
- The dashboard shows evaluation-mode messaging so reviewers know no real email is sent by default.

## What We Do Not Guarantee

Do not guarantee:

- Inbox placement.
- Reply rate.
- Revenue.
- That 100k+/day real sending works without operator-owned domains and provider capacity.
- That Gmail, Outlook, Yahoo, iCloud, or any ESP will accept traffic outside their policies.
- That the product replaces legal/compliance review.

## Safe 100k+/Day Wording

Use:

```text
Sovereign Engine is designed as a 100k+/day deliverability control plane. Real sending volume depends on the operator’s domains, ESP/MTA capacity, DNS, warmup history, suppression quality, and compliance policy.
```

Avoid:

```text
Guaranteed 100k emails per day with no setup.
```

## Proof Framing

The strongest proof is not “we promise everything.” The strongest proof is:

- The system launches from one command.
- The system clearly separates demo mode from real sending.
- The system exposes health, queue, worker, reputation, and trust surfaces.
- The system states exactly what the operator must connect before production traffic.

That honesty increases trust and reduces acquisition risk.
