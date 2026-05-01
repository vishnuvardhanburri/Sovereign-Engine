# Technical Proof Checklist

Use this checklist before submitting the repository or showing it to a technical buyer.

## Repository Branding

- README title says `Sovereign Engine`.
- App metadata says `Sovereign Engine`.
- API routes use `/api/sovereign-ai` and `/api/sovereign-ai-pro`.
- Package scope uses `@sovereign/*`.
- Docker project and volumes use `sovereign-engine` / `sovereign_engine`.

Quick check:

```bash
pnpm brand:check
```

Expected result: no matches.

## Build Checks

```bash
pnpm install
pnpm typecheck
pnpm -C workers/sender-worker build
DATABASE_URL='postgresql://postgres:password@127.0.0.1:5432/sovereign_engine?sslmode=disable' \
REDIS_URL='redis://127.0.0.1:6379' \
APP_DOMAIN='localhost:3400' \
APP_PROTOCOL='http' \
AUTH_SECRET='auth_secret_012345678901234567890123456789' \
CRON_SECRET='cron_secret_012345678901234567890123456789' \
SECURITY_KILL_SWITCH_TOKEN='kill_switch_012345678901234567890123456789' \
SECRET_MASTER_KEY='master_key_012345678901234567890123456789' \
MOCK_SMTP='true' \
pnpm -C apps/api-gateway build
```

## Infrastructure Checks

```bash
docker compose -f docker-compose.prod.yml config >/tmp/sovereign-compose.yml
pnpm prod:check
```

`pnpm prod:check` should block if `.env` contains placeholders. That is expected for unsafe production values.

## Demo Checks

```bash
pnpm demo:buyer
curl -s "http://localhost:3400/api/health/stats?client_id=1" | jq
STRESS_COUNT=10000 STRESS_TIMEOUT_MS=60000 pnpm stress:test
pnpm demo:buyer:stop
```

## Safe Buyer Language

Use:

- Designed for 100k+/day with horizontal workers and production-sized infrastructure.
- Mock stress proof validates queue and worker throughput without real email.
- Real capacity depends on provider policy, domains, IP reputation, DNS, suppression quality, and cloud resources.

Avoid:

- Universal inbox-outcome promises.
- Provider-policy shortcut claims.
- Hidden-infrastructure claims.
- Any promise that ignores consent, DNS, provider policy, or suppression requirements.
