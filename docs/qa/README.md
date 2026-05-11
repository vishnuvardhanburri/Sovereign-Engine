# Enterprise QA

Run the enterprise QA harness from `code/`:

```bash
pnpm qa:enterprise
```

When the production Docker stack is running, this validates:

- Static architecture gates.
- Buyer-safe copy and brand gates.
- API TypeScript.
- Platform SDK and realtime gateway checks.
- Production Docker Compose configuration.
- Health, proof, trust, production-gate, and public API auth endpoints.
- Key buyer-facing routes.
- Security scan for tracked runtime env files and WebSocket token transport.

Run Redis restart chaos against the local production stack:

```bash
pnpm qa:enterprise -- --chaos
```

Reports are written under `code/output/enterprise-qa/latest/`.

Run the 10K production-stack mock stress proof after `pnpm launch:ready --quick`:

```bash
STRESS_COUNT=10000 STRESS_TIMEOUT_MS=60000 pnpm stress:prod
```
