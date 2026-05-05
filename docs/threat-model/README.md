# Threat Model (Deliverability OS)

This is a lightweight threat model for technical due diligence. It focuses on real operational risks: credential leakage, tenant data bleed, abuse, and audit tampering.

## Assets

- SMTP/ESP credentials and API keys
- Tenant data (contacts, domains, campaign metadata)
- Reputation state (lane throttles, pauses, ramp limits)
- Audit logs and evidence packs

## Trust Boundaries

- Browser to API Gateway (public)
- API Gateway to Postgres/Redis (internal network)
- Workers to Postgres/Redis (internal network)
- Optional public Reputation API (rate-limited)

## Primary Threats and Mitigations

| Threat | Impact | Mitigations In Repo |
|---|---|---|
| Secret exposure in logs | Credential compromise | Masking layer + “no plaintext secrets in events” rule |
| Tenant data bleed | Cross-client data leak | ClientId scoping + RLS scripts + query guards |
| Abuse of public endpoints | DoS, data scraping | Rate limiting, API keys, and bounded responses |
| Replay / duplicate sends | Reputation damage, compliance risk | Idempotency keys + queue discipline |
| Audit log rewriting | Forensic failure | Hash-chained, append-only audit ledger |
| Infrastructure exhaustion | Disk fills, stalled queues | Log rotation + queue depth monitoring + backpressure controls |

## Out of Scope (Operator Responsibility)

- Host OS hardening, firewall/WAF, and secrets storage (KMS/Vault)
- TLS termination and certificate lifecycle
- Backup/restore processes and DR drills

