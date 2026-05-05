# Sovereign Engine 100-Point Proof Scorecard (Buyer Due Diligence)

This is a transparent, weighted scorecard that maps diligence questions to repeatable commands and artifacts.

This repo provides mock-safe validation and infrastructure proof tooling. It does not claim revenue, customers, or guaranteed inbox outcomes.

## Scorecard (100 Points Total)

| Category | Points | What “Pass” Means | Primary Proof |
|---|---:|---|---|
| Build and type safety | 15 | Clean typecheck and build on a fresh machine with the provided setup flow | `pnpm -C code install`, `pnpm typecheck`, `pnpm build` |
| Buyer-safe positioning | 10 | Public surfaces avoid risky language and remain compliance-first | `pnpm brand:check`, `pnpm copy:check` |
| Health Oracle | 15 | Health endpoint responds with DB/Redis latency, queue depth, and worker nodes | `GET /api/health/stats?client_id=1` |
| Queue and worker scale proof | 20 | Mock-safe pipeline drains at scale; heartbeats show multiple workers online | `STRESS_COUNT=10000 ... pnpm stress:test` + `/api/health/stats` |
| Reputation Command Center | 15 | Provider lanes visible as HEALTHY/THROTTLED/PAUSED with event feed and ramp graph | `/reputation` + `reputation_state` / `reputation_events` |
| Security and auditability | 15 | Privileged actions are logged; audit chain is tamper-evident; sensitive fields are masked | `/activity` + audit endpoints + DB tables |
| Data room and handoff | 10 | Data room ZIP generated with manifest and SHA-256; repeatable packaging flow | `pnpm generate:data-room` |

## Recommended Buyer Run (Minimal)

```bash
./setup.sh
pnpm demo:buyer
curl -s "http://localhost:3400/api/health/stats?client_id=1" | python3 -m json.tool | head -n 80
STRESS_COUNT=10000 STRESS_TIMEOUT_MS=60000 pnpm stress:test
pnpm generate:data-room
```

