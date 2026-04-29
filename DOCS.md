# Xavira Orbit Production Operating Guide

## What Xavira Orbit Does

Xavira Orbit is an email delivery control system. It does not simply push messages as fast as possible. It watches delivery signals, learns which provider lanes are healthy, and automatically slows down or pauses risky lanes before reputation damage spreads.

Think of it like a traffic control tower for outbound email:

- The API Gateway is the control room.
- Redis is the live traffic board.
- Postgres is the permanent system memory.
- The Reputation Worker is the brain.
- Sender Workers are the muscle.
- The Adaptive Controller decides when to accelerate, slow down, pause, or recover.

## One-Command Production Start

For a production-style Docker deployment:

```bash
docker compose -f docker-compose.prod.yml up -d --build --scale sender-worker=2
```

Scale sender capacity by increasing the worker count:

```bash
docker compose -f docker-compose.prod.yml up -d --scale sender-worker=6
```

Sender workers are stateless. Any worker can process any eligible send job because the source of truth lives in Postgres and Redis. This means workers can run on one EC2 instance, many EC2 instances, or any container platform that can reach the same Postgres and Redis.

## Five-Minute Local Setup

Fresh machine setup:

```bash
./setup.sh
```

The script creates `.env`, starts Postgres and Redis when Docker is available, installs dependencies, applies the database schema, and creates a demo user.

By default, setup uses `MOCK_SMTP=true`. That means the system proves queueing, throttling, event ingestion, health checks, and dashboards without sending real email.

## Adaptive Control Logic In Plain English

Every sending domain is split into provider lanes: Gmail, Outlook, Yahoo, and Other. Each lane has its own health state.

The states are:

- `HEALTHY`: The lane is sending normally.
- `THROTTLED`: Xavira Orbit sees warning signs and reduces speed.
- `PAUSED`: Xavira Orbit sees serious risk and stops that lane.

A Gmail problem does not have to stop Outlook. A bad domain does not have to stop the whole company. The system isolates risk so good traffic can continue safely.

## Safe Ramp

New or recently cooled-down domains start slowly. The default safe start is 50 emails per hour. If the lane stays healthy, capacity doubles over time. If deferrals, blocks, bounces, complaints, or seed placement get worse, the system slows down or pauses.

This protects the buyer from the classic mistake: blasting a new domain too quickly and damaging reputation before the campaign has a chance to work.

## Emergency Brake

If a provider lane crosses hard risk thresholds, Xavira Orbit writes a pause signal into Postgres and Redis. Sender workers read that signal before sending.

Example:

Gmail starts rejecting a domain. The Gmail lane is paused. Outlook and Yahoo can continue if their lanes are healthy.

Every throttle, pause, resume, and cooldown is logged into `reputation_events` so the dashboard can show exactly what happened and why.

## Worker Heartbeats

Each sender worker writes a heartbeat into Redis. The health endpoint exposes active workers:

```bash
curl http://localhost:3000/api/health/stats?client_id=1
```

The dashboard can show how many muscle nodes are online, their worker IDs, hostnames, concurrency, and whether they are running in mock mode.

## Scale Proof Mode

To prove queue throughput without sending real email:

```bash
MOCK_SMTP=true MOCK_SMTP_FASTLANE=true SENDER_WORKER_CONCURRENCY=50 pnpm worker:sender
STRESS_COUNT=10000 pnpm stress:test
```

The stress test creates mock contacts, marks them as validator-approved, creates queue jobs, pushes them through Redis, lets sender workers process them, and verifies `sent` events were ingested into Postgres.

This is intentionally a mock-delivery proof. Real delivery should always use conservative ramping, DNS authentication, bounce suppression, opt-out controls, and provider-aware throttling.

## Security Defaults

Operational logs mask emails, SMTP passwords, tokens, secrets, and API keys before writing to reputation/audit tables.

The kill switch endpoint can revoke active client sessions when a breach response is needed.

The production Compose file expects real secrets in `.env` or the host environment. Do not commit real SMTP credentials, API tokens, or database passwords.

## Buyer Summary

Xavira Orbit is built to be infrastructure agnostic. It can run on AWS EC2, Docker Compose, a VPS, or a container platform. The core scaling model is simple:

- Add sender workers to increase processing capacity.
- Keep Postgres and Redis shared.
- Let the Reputation Worker and Adaptive Controller decide what is safe to send.
- Watch `/api/health/stats` and the reputation dashboard to prove the system is alive, scaled, and controlled.
