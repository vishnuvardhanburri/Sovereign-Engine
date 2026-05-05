# Sovereign Engine Buyer Demo Guide

This is the safe five-minute demo path for buyers, investors, or technical reviewers.

The demo runs in mock mode. It proves the queue, dashboard, health oracle, audit surfaces, and worker flow without sending real email.

## One-Command Setup

```bash
pnpm demo:buyer
```

What it does:

- Ensures `.env` has demo-safe values.
- Starts Postgres and Redis with Docker Compose.
- Applies the database schema.
- Creates a demo user.
- Starts the API gateway on `localhost:3400`.
- Starts reputation and sender workers.
- Opens the login and reputation pages on macOS.

Demo login:

```text
demo@sovereign.local
Demo1234!
```

Stop demo processes:

```bash
pnpm demo:buyer:stop
```

## Buyer Tabs To Open

```text
http://localhost:3400/login
http://localhost:3400/reputation
http://localhost:3400/reputation?investor=1
http://localhost:3400/api/health/stats?client_id=1
http://localhost:3400/api/v1/reputation/docs
```

## Stress Proof Moment

Use this during recording after `pnpm demo:buyer` is running:

```bash
STRESS_COUNT=10000 STRESS_TIMEOUT_MS=60000 pnpm stress:test
```

If recording on a smaller laptop, use:

```bash
STRESS_COUNT=1000 STRESS_TIMEOUT_MS=60000 pnpm stress:test
```

Positioning language:

```text
This is a mock-safe scale proof. It exercises the validator-approved queue path,
sender worker, event ingestion, Redis queue, and Postgres persistence without
sending real email.
```

## Production Confidence Checks

Run these before a buyer call:

```bash
pnpm typecheck
pnpm -C code/workers/sender-worker build
docker compose -f code/docker-compose.prod.yml config >/tmp/sovereign-compose.yml
cp code/configs/env/.env.production.example code/.env
pnpm prod:check
```

The example production env should block because secrets are placeholders. That is expected and proves the readiness checker catches unsafe launches.

For a production-shaped validation with non-placeholder environment variables, use:

```bash
DATABASE_URL='postgresql://sovereign_user:prod-db-secret-2026@db.prod.internal:5432/sovereign_engine?sslmode=require' \
REDIS_URL='rediss://redis.prod.internal:6379' \
APP_DOMAIN='app.clientdomain.com' \
APP_PROTOCOL='https' \
AUTH_SECRET='auth_secret_012345678901234567890123456789' \
CRON_SECRET='cron_secret_012345678901234567890123456789' \
SECURITY_KILL_SWITCH_TOKEN='kill_switch_012345678901234567890123456789' \
SECRET_MASTER_KEY='master_key_012345678901234567890123456789' \
ZEROBOUNCE_API_KEY='zb_live_0123456789abcdef' \
SMTP_HOST='smtp.sendgrid.net' \
SMTP_USER='apikey' \
SMTP_PASS='SG.live-production-token-0123456789' \
MOCK_SMTP='false' \
SEND_ALLOW_UNKNOWN_VALIDATION='false' \
pnpm prod:check:real
```

## What Not To Claim

Do not claim universal inbox outcomes, provider-policy shortcuts, hidden infrastructure, or delivery promises the system cannot control.

Use this instead:

```text
Sovereign Engine is designed for compliant, provider-aware sending with adaptive
throttling, safe ramping, auditability, suppression controls, and mock-tested
horizontal worker scale.
```

## Recording Checklist

- Start with a 5-second clean-start proof: run `docker ps` before launching the demo.
- Show the login screen with Sovereign Engine branding, then the dashboard (visual hook).
- Show `/proof` (credibility): worker heartbeat + queue health tiles + readiness board.
- Run the stress command and keep `/proof` + `/reputation?investor=1` visible while it runs (power + system reacting).
- Close by showing the Data Room ZIP download (trust + closure), then `ls -lt code/output/data-room/*.zip | head -n 3` in terminal.

Buyer-safe line to say once:

```text
This is mock-safe validation, but the architecture is designed for production-scale deployment on real infrastructure.
```

## Generated Clip Pack

If you need clean B-roll before recording your own face/voice clips:

```bash
pnpm demo:clips
pnpm demo:package
```

This creates:

```text
code/output/video-clips/sovereign-engine-demo-clips.zip
code/output/video-clips/SOVEREIGN_ENGINE_VIDEO_MANIFEST.md
```
