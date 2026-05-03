# Human QA Checklist

Use this checklist before recording a demo or sharing the repository with a serious evaluator.

## 1. One-Command Readiness

Run:

```bash
pnpm launch:ready
```

Expected result:

- Brand check passes.
- Buyer-safe copy check passes.
- Docker compose config is valid.
- Health oracle responds.
- Demo login is created.
- Demo metrics API responds.
- Pricing page responds.
- Trust certificate API responds.
- Production gate confirms real sending is locked in demo mode.
- Submission evidence pack is generated.

## 2. Browser Walkthrough

Open:

```text
http://localhost:3400/login
demo@sovereign.local
Demo1234!
```

Human test path:

- Login succeeds and lands on `/dashboard`.
- The evaluation-mode banner is visible.
- `/reputation` shows provider lane status.
- `/proof` shows health, workers, queue state, and proof commands.
- `/trust` explains safe claims and non-claims.
- `/limits` explains operator inputs and gated sending.
- `/handoff` explains deployment handoff and setup commands.
- `/pricing` shows Starter, Growth, and Enterprise pricing.

## 3. API Proof

Run after `pnpm launch:ready`:

```bash
curl http://localhost:3400/api/health/stats?client_id=1
curl http://localhost:3400/demo/metrics
curl http://localhost:3400/api/trust/summary?domain=sovereign-demo.example
curl http://localhost:3400/api/production/gate?domain=sovereign-demo.example
```

Expected result:

- Health endpoint returns `ok: true`.
- Demo metrics show `SIMULATED_DELIVERABILITY_PROOF`.
- Trust summary returns safe-claim boundaries.
- Production gate says real sending is not allowed until operator inputs are connected.

## 4. Human Acceptance Criteria

Pass only if:

- The product does not claim guaranteed inbox placement.
- The product does not claim fake revenue or customers.
- The product does not imply unlimited real sending without domains, ESP/MTA capacity, DNS, warmup, and compliance.
- The demo can be repeated from a clean terminal command.
- The operator can clearly understand what is included and what they must connect.

## 5. If Something Fails

Use this order:

1. Run `pnpm launch:stop`.
2. Confirm Docker Desktop is running.
3. Run `pnpm brand:check && pnpm copy:check`.
4. Run `pnpm launch:ready` again.
5. If Docker hangs on macOS, check for iCloud dataless files and run from a fully local clone outside synced storage.
