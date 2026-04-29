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
STRESS_COUNT=10000 STRESS_TIMEOUT_MS=60000 pnpm stress:test
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

## Reputation Shield API

Xavira Orbit now exposes its reputation intelligence as a public product surface:

```bash
curl http://localhost:3000/api/v1/reputation/score/example.com
```

If `REPUTATION_PUBLIC_API_KEY` is set, callers must include:

```bash
curl -H "x-api-key: $REPUTATION_PUBLIC_API_KEY" \
  http://localhost:3000/api/v1/reputation/score/example.com
```

The API returns a domain score, provider lane health, observed ramp limits, and recommendations. This turns the internal Adaptive Controller into a standalone deliverability intelligence product.

## Reputation-as-a-Service API

The production public endpoint is:

```text
POST /api/v1/reputation/score
```

Request:

```json
{
  "domain": "example.com",
  "ip": "1.2.3.4"
}
```

Create a database-backed API key:

```bash
pnpm public-api-key:create -- --name "Partner Demo" --tier free
```

Call the API:

```bash
curl -X POST "http://localhost:3000/api/v1/reputation/score" \
  -H "x-api-key: $XAVIRA_REPUTATION_API_KEY" \
  -H "content-type: application/json" \
  -d '{"domain":"example.com","ip":"1.2.3.4"}'
```

The response is a Health Certificate containing:

- `reputation_score`: 0-100 score from internal reputation state or shadow light scan.
- `provider_status`: Gmail, Outlook, and Yahoo lane health with cache/source attribution.
- `blacklist_status`: Spamhaus DBL/ZEN and URIBL DNSBL check results.
- `recommendation`: autonomous advice such as safe ramp, cautious proceed, or cooldown.
- `billing`: tier, daily usage, billable units, and reset time.

Tier defaults:

```bash
PUBLIC_REPUTATION_FREE_DAILY_LIMIT=10
PUBLIC_REPUTATION_PRO_DAILY_LIMIT=1000
PUBLIC_REPUTATION_ENTERPRISE_DAILY_LIMIT=100000
PUBLIC_REPUTATION_BLACKLIST_CACHE_SEC=21600
```

Developer docs:

```text
/api/v1/reputation/docs
/api/v1/reputation/openapi.json
```

## Multi-Region Reputation Sync

The central source of truth is still Postgres. Redis is the real-time lane signal bus for sender workers.

To publish adaptive lane decisions into multiple regional Redis clusters, configure:

```bash
ADAPTIVE_REDIS_PEERS=us-east=redis://10.0.1.10:6379,eu-west=redis://10.0.2.10:6379,ap-south=redis://10.0.3.10:6379
```

The Reputation Worker writes provider lane state into each region using region-scoped keys:

```text
xv:{region}:adaptive:lane:{clientId}:{domainId}:{provider}
xv:{region}:adaptive:lane_pause:{clientId}:{domainId}:{provider}
```

Sender workers in each region set `XV_REGION` to their local region and read their local Redis keys. This lets one central brain coordinate many distributed muscle nodes.

## Investor Mode

Open the hidden investor view:

```text
/reputation?investor=1
```

Investor Mode shows:

- Value generated today from estimated inboxed emails at the configured B2B lead value.
- Estimated sending cost.
- Gross margin.
- ROI multiple.
- Projected daily capacity from current lane limits.

Configure assumptions:

```bash
INVESTOR_LEAD_VALUE_USD=0.5
COST_PER_SEND=0.002
```

## Content AI Boundary

Xavira Orbit supports compliant template quality and approved variation workflows, but it does not build evasion systems whose purpose is to bypass ISP or AI pattern filters. Sustainable deliverability comes from relevance, consent, authentication, suppression, pacing, and reputation discipline.

The safe product direction is:

- Generate clearer, more relevant copy from approved claims.
- Preserve unsubscribe and sender identity requirements.
- Keep audit trails for generated copy.
- Reject misleading, impersonating, or detection-evasion prompts.

## Local Content Mutation Middleware

The sender worker can optionally use a local-only mutation service. It connects to Ollama or another internal Llama/Mistral-compatible endpoint and never sends message content to OpenAI or any external API.

It is disabled by default:

```bash
CONTENT_MUTATION_ENABLED=false
```

To run the optional local model in Docker:

```bash
docker compose -f docker-compose.prod.yml --profile content-ai up -d ollama ollama-pull
```

Then enable mutation for sender workers:

```bash
CONTENT_MUTATION_ENABLED=true \
CONTENT_MUTATION_ENDPOINT=http://ollama:11434/api/generate \
docker compose -f docker-compose.prod.yml up -d --scale sender-worker=2
```

How it works:

- The first sends for a campaign batch trigger a Redis mutation pool fill in the background.
- The pool target is 500 approved local variations per campaign/sequence/template.
- Sender workers randomly pull from the pool and apply a tiny local jitter before SMTP.
- Links, tracked URLs, and unsubscribe/preference lines are immutable and are validated before send.
- If the local model is unavailable or alters protected content, the worker falls back to the original approved copy or a safe deterministic edit.

Recommended defaults:

```bash
CONTENT_MUTATION_POOL_SIZE=500
CONTENT_MUTATION_FILL_PER_LOCK=500
CONTENT_MUTATION_TIMEOUT_MS=12000
CONTENT_MUTATION_POOL_TTL_SEC=86400
```

## Founder's Manifesto: The Five-Year AI-Deliverability War

Email is becoming an adversarial trust market. Inbox providers will keep improving automated filtering. Senders will keep searching for shortcuts. Xavira Orbit's position is different: we win by becoming the most disciplined reputation operating system in the market.

Year 1: Build the control tower. The product must make every send explainable, every pause auditable, and every ramp decision defensible.

Year 2: Turn reputation intelligence into a standalone API. Customers should be able to use Xavira Orbit even when another system sends their email.

Year 3: Become infrastructure agnostic. The same brain should control workers across AWS, VPS providers, Kubernetes, and edge regions.

Year 4: Build a trusted data moat. Aggregate anonymized provider-lane signals, seed placement outcomes, suppression patterns, and recovery playbooks into a continuously improving reputation model.

Year 5: Own the compliant outbound category. The market will punish reckless bulk systems. Xavira Orbit should be known as the platform that scales outreach without hiding from rules, users, or providers.

The founding principle is simple: durable inbox placement is not hacked. It is earned, measured, protected, and compounded.
