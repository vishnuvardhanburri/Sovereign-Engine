# Xavira Orbit Architecture

Xavira Orbit is an outbound infrastructure platform built as a queue-driven, stateless-worker system.

## Monorepo Layout

- `apps/api-gateway`: Primary product UI + gateway APIs (Next.js App Router).
- `services/validator-engine`: Email validation pipeline + validator API/worker entrypoints.
- `workers/sender-worker`: Queue-driven sender worker (stateless) that executes send jobs using the gateway's DB/Redis.
- `infra/docker`: Local infrastructure (Postgres + Redis) templates.
- `configs/*`: Declarative configuration (env templates, limits, domains).
- `libs/*`: Shared libraries (planned extraction target).

## Service Boundaries (Target)

- Validator Engine: normalization, syntax, disposable/role, DNS/MX, SMTP probe, catch-all, scoring.
- Decision Engine: maps validation output + domain reputation to an action + lane.
- Sending Engine: rotation, warmup, rate limiting, per-domain and per-inbox guards.
- Tracking Engine: delivered/bounced/replied ingestion and persistence.
- Reputation Engine: domain/inbox scoring and circuit breakers.

## Key Rules

- Backend is source of truth.
- No direct sending without validation.
- Domain protection > volume.
- Fail fast on uncertainty (UNKNOWN defers).

