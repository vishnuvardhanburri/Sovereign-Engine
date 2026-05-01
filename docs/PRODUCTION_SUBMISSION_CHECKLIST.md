# Sovereign Engine Production Submission Checklist

This is the final buyer/client handoff checklist. Sovereign Engine should handle the platform, queueing, dashboards, safety controls, worker scaling, audit logs, health checks, and mock proof runs. The client only needs to supply the external infrastructure and sending credentials that no software can safely invent.

## Client Inputs Required

These are the only mandatory outside pieces for a real production send:

- VPS or cloud host with Docker installed, 2+ vCPU, 4+ GB RAM recommended for the first production node.
- Production domain for the dashboard, for example `orbit.client.com`, with HTTPS reverse proxy or load balancer.
- Sending domains and inboxes already purchased and controlled by the client.
- DNS records for every sending domain: SPF, DKIM, DMARC, MX where needed, tracking domain if used, and provider verification records.
- SMTP or ESP credentials, for example Amazon SES, Brevo, Resend, Mailgun, SendGrid, or a managed MTA.
- Email validation key, currently `ZEROBOUNCE_API_KEY`.
- Lawful contact source, suppression list, unsubscribe policy, and physical mailing address where required.

## What Sovereign Engine Handles

- Postgres schema, migrations, queue tables, audit tables, reputation tables, and public API key tables.
- Redis queueing, provider lane state, worker heartbeats, idempotency locks, and adaptive pause signals.
- API Gateway, dashboard, `/reputation` command center, `/api/health/stats`, and Reputation-as-a-Service endpoints.
- Reputation Worker brain with provider-aware lane decisions.
- Stateless sender workers that can be horizontally scaled.
- Mock SMTP proof mode so the system can be demoed without sending real email.
- Tamper-evident audit logs and secret masking.
- Docker log rotation and optional cold archive profile.
- Manual Pause/Resume controls and kill-switch readiness.

## Server Go-Live Sequence

1. Clone the repo on the server.
2. Copy the production template:

```bash
cp configs/env/.env.production.example .env
```

3. Fill real values in `.env`.
4. Run the production checker:

```bash
pnpm prod:check:real
```

5. Start the stack in safe mock mode first:

```bash
MOCK_SMTP=true docker compose -f docker-compose.prod.yml up -d --build --scale sender-worker=2
```

6. Create an admin user:

```bash
pnpm user:create admin@client.com 'replace-with-strong-password'
```

7. Open:

```text
https://orbit.client.com/dashboard
https://orbit.client.com/reputation
https://orbit.client.com/api/health/stats?client_id=1
```

8. Run mock proof before real sends:

```bash
STRESS_COUNT=500 STRESS_TIMEOUT_MS=60000 pnpm stress:test
```

9. Confirm the dashboard shows active workers, queue depth, reputation lanes, and no health blockers.
10. Switch to real sending only after DNS and provider verification pass:

```bash
MOCK_SMTP=false docker compose -f docker-compose.prod.yml up -d --scale sender-worker=2
pnpm prod:check:real
```

## DNS Gate

Do not start a real campaign until every sending domain has:

- SPF includes the active ESP/MTA and does not use `+all`.
- DKIM is 2048-bit where supported and aligned with the sender domain.
- DMARC exists and is at least monitoring during initial setup, then moved toward quarantine/reject when stable.
- Provider/domain verification is complete inside the ESP.
- Bounce/complaint handling is configured where the ESP supports it.
- Unsubscribe or opt-out mechanism is present in outbound copy where legally required.

## Production Acceptance Tests

Run these before submission or client handoff:

```bash
pnpm typecheck
pnpm -C workers/sender-worker build
docker compose -f docker-compose.prod.yml config >/tmp/sovereign-compose.yml
pnpm prod:check
curl -sS "$APP_PROTOCOL://$APP_DOMAIN/api/health/stats?client_id=1"
```

Expected:

- API, Redis, and Postgres report healthy.
- Sender worker heartbeat count matches the running container count.
- BullMQ waiting/active counts are sane.
- `workers.sender.stale` is `0` after 60 seconds of stable runtime.
- Browser login works.
- `/reputation` loads without console errors.

## Real Sending Rules

- Start with low volume and let safe-ramp increase only after healthy windows.
- Never import unverified or purchased lists without a lawful basis and suppression cleanup.
- Keep `SEND_ALLOW_UNKNOWN_VALIDATION=false` for strict production mode.
- Watch bounce, block, complaint, and deferral rates.
- If any provider lane pauses, fix the underlying signal instead of forcing volume.

## Submission Summary

The final submission story is:

```text
Sovereign Engine is deployable with one Docker Compose stack, inspectable through health endpoints, provable through mock stress tests, and ready for real sending once the client supplies domains, DNS, SMTP/ESP credentials, validation keys, and compliant contact data.
```

