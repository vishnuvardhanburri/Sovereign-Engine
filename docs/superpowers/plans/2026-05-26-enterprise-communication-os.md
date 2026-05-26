# Enterprise Communication OS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for the multi-worker build phases, or superpowers:executing-plans for single-agent implementation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Xavira Control Stack from CSV-assisted outbound infrastructure into an enterprise communication governance and operational intelligence operating system.

**Architecture:** Add a unified ingestion layer, prospect intelligence engine, operational decision engine, conversation intelligence, CRM sync, workflow automation, multi-tenant governance, and an executive operations command center on top of the existing Sovereign Engine and Sovereign Shield codebase.

**Tech Stack:** Node.js, TypeScript, Next.js App Router, BullMQ, Redis, Postgres, WebSockets, Docker, Tauri, React Native, Ollama-first local AI, provider-aware email infrastructure, audit ledger.

---

## Phase 0 - Ground Rules

- [ ] Keep CSV as fallback only. Every ingestion path must normalize through the same canonical pipeline.
- [ ] Do not add provider-bypass logic. Delivery improvements must come from authentication, verification, suppression, reputation controls, and compliant sender behavior.
- [ ] Every worker job must include `tenantId`, `idempotencyKey`, and `auditTraceId`.
- [ ] Every state-changing API must write an audit event.
- [ ] Every connector must be rate-limited and retry-safe.
- [ ] Every automated send decision must be explainable.

Verification command:

```bash
pnpm --dir code/apps/api-gateway exec tsc --noEmit --pretty false
```

---

## Phase 1 - Database Foundation

### Task 1.1 - Add Ingestion and Intelligence Tables

- [ ] Add a migration or extend the existing schema bootstrap in `code/apps/api-gateway/scripts/init-db.ts`.
- [ ] Create tables:
  - `source_connections`
  - `ingestion_jobs`
  - `raw_source_records`
  - `company_entities`
  - `prospect_entities`
  - `entity_resolution_links`
  - `prospect_scores`
  - `decision_events`
  - `conversation_events`
  - `crm_sync_state`
  - `workflow_definitions`
  - `workflow_runs`
  - `tenant_policies`
  - `governance_evidence`
- [ ] Add indexes:
  - `(tenant_id, email)` on `prospect_entities`
  - `(tenant_id, domain)` on `company_entities`
  - `(tenant_id, source_type, external_id)` on `raw_source_records`
  - `(tenant_id, created_at)` on audit-heavy event tables
  - `(tenant_id, classification, created_at)` on `conversation_events`
- [ ] Add conflict-safe unique constraints for idempotency.

Verification:

```bash
pnpm --dir code/apps/api-gateway db:init
pnpm --dir code/apps/api-gateway exec tsc --noEmit --pretty false
```

### Task 1.2 - Add Governance Evidence Helper

- [ ] Create `code/apps/api-gateway/lib/governance/evidence-ledger.ts`.
- [ ] Export `writeGovernanceEvidence(input)`.
- [ ] Include `tenantId`, `traceId`, `eventType`, `actorType`, `actorId`, and redacted payload.
- [ ] Use this helper in new APIs and workers before direct table writes spread.

Acceptance:

- [ ] Evidence writes are idempotent when a caller supplies a stable trace/event pair.
- [ ] Sensitive raw payloads are redacted unless the event type explicitly requires retention.

---

## Phase 2 - Unified Ingestion Layer

### Task 2.1 - Connector Registry

- [ ] Create `code/apps/api-gateway/lib/ingestion/connector-registry.ts`.
- [ ] Define connector metadata:
  - `apollo`
  - `hubspot`
  - `salesforce`
  - `clay`
  - `smartlead`
  - `instantly`
  - `linkedin_enrichment`
  - `website_research`
  - `rest`
  - `webhook`
  - `csv`
- [ ] Store connector capabilities:
  - pull support
  - webhook support
  - auth type
  - rate-limit defaults
  - source trust score
  - allowed entity types

Acceptance:

- [ ] A connector can be looked up by source type.
- [ ] Unknown source types fail closed.

### Task 2.2 - Batch Ingestion API

- [ ] Add `code/apps/api-gateway/app/api/ingestion/batch/route.ts`.
- [ ] Require tenant authentication and idempotency key.
- [ ] Validate payload shape.
- [ ] Create or reuse `ingestion_jobs`.
- [ ] Store raw source records by payload hash.
- [ ] Enqueue `xv-ingestion` jobs.
- [ ] Return compact JSON by default for cron/webhook compatibility.

Contract:

```http
POST /api/ingestion/batch
Authorization: Bearer <tenant_api_key>
Idempotency-Key: <source>:<external_batch_id>
X-Xavira-Source: hubspot
```

Acceptance:

- [ ] Duplicate `Idempotency-Key` returns the same job status, not duplicate prospects.
- [ ] Invalid records are counted and audited without failing the whole batch.

### Task 2.3 - Webhook Ingestion API

- [ ] Add `code/apps/api-gateway/app/api/ingestion/webhook/[source]/route.ts`.
- [ ] Verify HMAC signature and timestamp drift.
- [ ] Reject replayed event IDs.
- [ ] Store raw payload.
- [ ] Enqueue transformation.
- [ ] Return within 1 second when possible.

Acceptance:

- [ ] Invalid signatures return `401`.
- [ ] Replay returns `409` with existing event reference.

### Task 2.4 - Ingestion Worker

- [ ] Create `code/workers/ingestion-worker/index.ts`.
- [ ] Register `xv-ingestion` BullMQ worker.
- [ ] Implement job types:
  - `normalize_record`
  - `resolve_entity`
  - `enqueue_intelligence`
- [ ] Add worker launch support in `scripts/render-start.sh` with `WEB_EMBED_INGESTION_WORKER`.
- [ ] Keep memory profile safe for Render free tier.

Acceptance:

- [ ] Worker can process records with concurrency 1 on small memory.
- [ ] Job failures retry with exponential backoff.
- [ ] Poison records go to review state after max attempts.

### Task 2.5 - Normalization and Entity Resolution

- [ ] Create `code/apps/api-gateway/lib/ingestion/normalize.ts`.
- [ ] Create `code/apps/api-gateway/lib/ingestion/entity-resolution.ts`.
- [ ] Normalize email, company domain, title, seniority, source references, and evidence.
- [ ] Merge entities using:
  - tenant + email
  - tenant + source + external ID
  - tenant + company domain + name fields
- [ ] Preserve raw payload for audit, but never use raw values directly in outbound copy.

Verification:

```bash
pnpm --dir code/apps/api-gateway exec tsx scripts/test-ingestion-normalize.ts
```

If the test script does not exist, create it with deterministic fixture records from HubSpot, Apollo, and REST ingestion.

---

## Phase 3 - Prospect Intelligence Engine

### Task 3.1 - Scoring Module

- [ ] Create `code/apps/api-gateway/lib/intelligence/scoring.ts`.
- [ ] Implement:
  - `scoreOutboundReadiness`
  - `scoreInfrastructureFit`
  - `scoreAiGovernanceFit`
  - `scoreAgencyFit`
  - `scoreDeliverabilityRisk`
  - `scoreEnterprisePriority`
- [ ] Return score plus reason array for every component.
- [ ] Store score snapshots in `prospect_scores`.

Acceptance:

- [ ] A prospect can be scored without external AI.
- [ ] Score output is stable for the same input.
- [ ] Reasons are operator-readable.

### Task 3.2 - Enrichment Workflow

- [ ] Create `code/apps/api-gateway/lib/intelligence/enrichment.ts`.
- [ ] Use existing public/evidence-backed enrichment helpers where possible.
- [ ] Enrich company category, employee range, likely outbound maturity, AI/security signal, and agency signal.
- [ ] Require source provenance for high-confidence claims.
- [ ] Add `xv-intelligence` worker or extend ingestion worker to enqueue intelligence jobs.

Acceptance:

- [ ] Missing enrichment does not block safe CRM-owned contacts.
- [ ] Weak evidence lowers score instead of inventing facts.

### Task 3.3 - Priority Lanes

- [ ] Create `code/apps/api-gateway/lib/intelligence/prioritization.ts`.
- [ ] Map score combinations to:
  - `enterprise_direct`
  - `agency_white_label`
  - `audit_first`
  - `research_more`
  - `do_not_contact`
- [ ] Expose lane in prospects dashboard and daily reports.

---

## Phase 4 - Operational Decision Engine

### Task 4.1 - Extract Decision Engine

- [ ] Create `code/apps/api-gateway/lib/decision/evaluate.ts`.
- [ ] Move send/defer/drop/review logic out of route handlers into a pure function.
- [ ] Inputs must include validation, suppression, domain auth, identity capacity, provider health, sequence state, and tenant policy.
- [ ] Outputs must include action, lane, provider preference, sender identity, sendAfter, reasons, riskScore, and auditTraceId.

Acceptance:

- [ ] Unit tests cover invalid email, suppressed contact, replied contact, DNS incomplete, capacity exhausted, bounce pressure, and successful send.

### Task 4.2 - Provider Lane Logic

- [ ] Create `code/apps/api-gateway/lib/decision/provider-lanes.ts`.
- [ ] Implement recipient ecosystem detection:
  - Google Workspace
  - Microsoft 365
  - Yahoo/AOL
  - custom corporate MX
- [ ] Rank providers by authentication, recent failures, tenant preference, and capacity.
- [ ] Do not implement bypass logic. Use only safe routing and throttling.

### Task 4.3 - Emergency Brake

- [ ] Create `code/apps/api-gateway/lib/decision/emergency-brake.ts`.
- [ ] Trigger brakes for bounce pressure, provider auth failures, high retry rate, DNS invalidation, memory pressure, and negative reply spike.
- [ ] Persist brake events.
- [ ] Surface brake state in dashboard and Telegram.

---

## Phase 5 - Conversation Intelligence

### Task 5.1 - Reply Classification

- [ ] Create `code/apps/api-gateway/lib/conversation/classify.ts`.
- [ ] Create `code/apps/api-gateway/lib/conversation/deterministic-rules.ts`.
- [ ] Classify replies as:
  - `interested`
  - `partnership_interest`
  - `pricing_interest`
  - `objection`
  - `not_interested`
  - `unsubscribe`
  - `bounce_or_dsn`
  - `auto_reply`
  - `neutral`
- [ ] Store classifications in `conversation_events`.

Acceptance:

- [ ] Delivery Status Notifications are counted as bounces, not interested replies.
- [ ] Human replies stop follow-ups immediately.

### Task 5.2 - Ollama-First Optional Router

- [ ] Create `code/apps/api-gateway/lib/conversation/ollama-router.ts`.
- [ ] Use local Ollama if `OLLAMA_BASE_URL` is set.
- [ ] Fall back to deterministic rules if unavailable or slow.
- [ ] Never block inbound processing on AI availability.

### Task 5.3 - Conversations Dashboard Fix

- [ ] Update `code/apps/api-gateway/app/api/replies/route.ts` or equivalent replies endpoint to read `conversation_events`.
- [ ] Update `code/apps/api-gateway/app/(dashboard)/inbox/page.tsx` to show:
  - who replied
  - subject
  - classification
  - matched prospect
  - sequence stopped state
  - recommended next action
- [ ] Add filters for interested, pricing, partnership, objection, unsubscribe, bounce/DSN, and neutral.

---

## Phase 6 - CRM Synchronization

### Task 6.1 - CRM Outbox

- [ ] Create `code/apps/api-gateway/lib/sync/crm-outbox.ts`.
- [ ] Add `xv-crm-sync` queue.
- [ ] Write CRM sync requests from domain events, not inline route handlers.
- [ ] Add idempotency keys for every sync operation.

### Task 6.2 - Adapter Interfaces

- [ ] Create adapter interface:

```ts
export type CrmAdapter = {
  name: string
  upsertContact(input: CrmContactInput): Promise<CrmSyncResult>
  createActivity(input: CrmActivityInput): Promise<CrmSyncResult>
  updateDeal?(input: CrmDealInput): Promise<CrmSyncResult>
}
```

- [ ] Implement stubs first:
  - `hubspot.ts`
  - `salesforce.ts`
  - `pipedrive.ts`
  - `notion.ts`
  - `airtable.ts`
  - `webhook.ts`

### Task 6.3 - Conflict Resolution

- [ ] Implement field ownership rules:
  - CRM owns deal stage.
  - Xavira owns communication status.
  - Suppression wins everywhere.
  - Verified CRM email beats unverified scraped email.
- [ ] Write conflicts to audit and manual review.

---

## Phase 7 - Executive Command Center

### Task 7.1 - Command Center API

- [ ] Add `code/apps/api-gateway/app/api/command-center/graph/route.ts`.
- [ ] Return:
  - worker topology
  - queue depth and age
  - provider health
  - domain auth state
  - decision reason distribution
  - prospect intelligence funnel
  - conversation funnel
  - CRM sync health
  - governance policy blocks

Acceptance:

- [ ] Endpoint returns compact JSON under cron/browser-safe size.
- [ ] Slow sections degrade gracefully.

### Task 7.2 - Command Center UI

- [ ] Update `code/apps/api-gateway/app/(dashboard)/dashboard/page.tsx` or add a new route.
- [ ] Create sections:
  - Executive state strip.
  - Infrastructure topology.
  - Queue pressure.
  - Intelligence funnel.
  - Decision engine.
  - Conversation intelligence.
  - Governance ledger.
  - Incidents.
- [ ] Keep typography concise and operational.

### Task 7.3 - WebSocket Stream

- [ ] Add a realtime stream for worker heartbeat and incident updates.
- [ ] If WebSockets are not available on the deployment tier, use SSE or polling.
- [ ] Keep fallback polling interval configurable.

---

## Phase 8 - Workflow Engine

### Task 8.1 - Workflow Definitions

- [ ] Create `code/apps/api-gateway/lib/workflows/definitions.ts`.
- [ ] Define trigger, condition, action, rollback, version, enabled state.
- [ ] Store definitions in `workflow_definitions`.

### Task 8.2 - Workflow Evaluator

- [ ] Create `code/apps/api-gateway/lib/workflows/evaluator.ts`.
- [ ] Evaluate workflows from domain events.
- [ ] Write `workflow_runs`.
- [ ] Enqueue actions to `xv-workflows`.

### Task 8.3 - Workflow Actions

- [ ] Create `code/apps/api-gateway/lib/workflows/actions.ts`.
- [ ] Implement actions:
  - pause identity
  - pause domain
  - create CRM task
  - notify Telegram
  - suppress contact
  - request enrichment
  - re-score prospect
  - create incident
- [ ] Add rollback for reversible actions.

---

## Phase 9 - Multi-Tenant Enterprise Controls

### Task 9.1 - Tenant Context Hardening

- [ ] Audit all new APIs for tenant filtering.
- [ ] Ensure queue jobs include tenant and audit trace.
- [ ] Ensure connectors cannot cross tenant boundaries.

### Task 9.2 - RBAC

- [ ] Add role checks for:
  - connector setup
  - workflow editing
  - domain/identity controls
  - governance exports
  - manual overrides
- [ ] Keep read-only analyst and auditor paths separate.

### Task 9.3 - Licensing Enforcement

- [ ] Add license capability checks for:
  - white-label tenants
  - CRM connectors
  - workflow automation
  - local AI governance
  - maximum identities
  - maximum sub-tenants
- [ ] Enforce in APIs and workers, not just UI.

---

## Phase 10 - Sovereign Shield Deep Integration

### Task 10.1 - Policy Engine

- [ ] Create `code/apps/api-gateway/lib/governance/policy-engine.ts`.
- [ ] Enforce:
  - source provenance required
  - suppression hard blocks
  - PII minimization
  - copy claim safety
  - local-first AI routing
  - retention policy
- [ ] Return policy decisions with reasons.

### Task 10.2 - Copy Governance

- [ ] Run outbound copy through policy checks before queueing.
- [ ] Block guaranteed outcomes, misleading claims, sensitive data, and spammy language.
- [ ] Store policy evidence.

### Task 10.3 - Retention Policy

- [ ] Keep recent sent body previews visible for operator review.
- [ ] Redact bodies after configured review window.
- [ ] Keep delivery proof, subject, classification, and audit metadata.
- [ ] Make retention window tenant-configurable.

---

## Phase 11 - Deployment and Reliability

### Task 11.1 - Render Small Profile

- [ ] Keep default memory-safe profile:
  - sender replicas: 1
  - sender concurrency: 1
  - worker Postgres pool: 1
  - inbound worker enabled only if memory allows
- [ ] Add `WEB_EMBED_INGESTION_WORKER=false` by default for free tier until tested.

### Task 11.2 - Enterprise Profile

- [ ] Add deployment documentation for separate worker services:
  - api-gateway
  - sender-worker
  - inbound-worker
  - ingestion-worker
  - intelligence-worker
  - crm-sync-worker
  - workflow-worker
- [ ] Define Redis and Postgres pool sizes per worker.

### Task 11.3 - Operational Runbooks

- [ ] Add runbooks for:
  - no sends today
  - no verified leads
  - DNS authentication incomplete
  - high bounces
  - inbound worker disconnected
  - cron timeout
  - Render out of memory
  - Redis eviction warning
  - CRM sync failures

---

## Phase 12 - Verification Matrix

Before marking this program complete:

- [ ] Ingestion API accepts and dedupes REST records.
- [ ] CSV importer routes through ingestion pipeline.
- [ ] Prospect intelligence scores are visible in dashboard.
- [ ] Decision events are stored for send/defer/drop/review.
- [ ] Emergency brake can pause a domain.
- [ ] Inbound replies appear in Conversations with sender identity.
- [ ] DSN/bounce emails do not count as interested replies.
- [ ] CRM sync outbox retries transient failures.
- [ ] Workflow engine can trigger a Telegram alert.
- [ ] Command Center shows live worker/queue/provider state.
- [ ] Governance ledger shows policy decisions.
- [ ] `pnpm --dir code/apps/api-gateway exec tsc --noEmit --pretty false` passes.
- [ ] `git diff --check` passes.

---

## First Implementation Slice

Start with these files first:

```text
code/apps/api-gateway/lib/ingestion/connector-registry.ts
code/apps/api-gateway/lib/ingestion/normalize.ts
code/apps/api-gateway/lib/ingestion/entity-resolution.ts
code/apps/api-gateway/app/api/ingestion/batch/route.ts
code/workers/ingestion-worker/index.ts
code/apps/api-gateway/lib/intelligence/scoring.ts
```

Reason: this breaks CSV dependency without touching sending risk. Once the system can ingest and score from many sources, delivery can remain conservative and stable while enterprise value increases.
