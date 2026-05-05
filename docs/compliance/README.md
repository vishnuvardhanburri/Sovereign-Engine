# Compliance Mapping (SOC2-Oriented)

This document is a pragmatic mapping for SOC2-style due diligence. It is not a certification claim.

## What Sovereign Engine Provides In-Repo

- Tamper-evident audit ledger (hash-chained, append-only) for privileged actions.
- Secret masking in event/audit logging surfaces (no plaintext SMTP passwords or recipient emails in logs).
- Kill-switch capability for incident response (rapidly disable tokens / privileged operations).
- Health Oracle for operational monitoring (DB/Redis latency, queue depth, worker heartbeats).
- Log rotation defaults in `code/docker-compose.prod.yml` (Docker JSON log caps) + optional archive profile.
- Tenant isolation support (RLS script + clientId scoping in queries).

## What The Operator Must Provide (Outside The Repo)

- Identity provider / SSO policy (if required).
- Change management and access reviews.
- Incident response runbooks and on-call process.
- Backups, restore drills, and DR testing for Postgres/Redis.
- Host hardening, patching, firewalling, and TLS termination (reverse proxy / load balancer).

## SOC2 Mapping (High Level)

| SOC2 Area | What A Buyer Verifies | Sovereign Engine Evidence |
|---|---|---|
| Security | Access control, audit trails, incident response | Audit chain + kill switch + masked logs |
| Availability | Monitoring, capacity controls, failure handling | Health Oracle + queue depth + worker autoscaling profile |
| Confidentiality | Secrets handling, least privilege, data minimization | AES keyring support + masking + RLS |
| Processing Integrity | Idempotency, correct job handling, retries | BullMQ retry strategy + DLQ + event taxonomy |
| Privacy (if applicable) | PII protection, retention, consent and suppression | Consent fields + suppression + opt-out enforcement |

