# Sovereign Validator Engine

Production-grade hybrid email validation service (open-source logic re-implemented cleanly):

API → Queue → Workers → Cache → DB

- API: Fastify (`POST /validate`, `POST /bulk-validate`)
- Queue: BullMQ
- Workers: parallel DNS/MX + SMTP validators
- Cache: Redis (domain MX + catch-all cache + reputation/circuit breaker)
- DB: Postgres (history + scoring)

This folder is intentionally standalone. It does **not** vendor or merge any third‑party repo code.

## Dev

1. Ensure `.env` has:
   - `DATABASE_URL`
   - `REDIS_URL`
   - `APP_DOMAIN`
   - `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` (needed for the main app; validator uses separate probe settings below)
   - `VALIDATOR_FROM_EMAIL` (optional)
   - `VALIDATOR_HELO_NAME` (optional)

2. Start the API:

```bash
pnpm validator:api
```

3. Start workers (in another terminal):

```bash
pnpm validator:worker
```

