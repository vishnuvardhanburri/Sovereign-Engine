# Autonomous Enterprise Communication OS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace CSV-first outbound operations with an autonomous, Ollama-first, event-driven enterprise communication operations platform.

**Architecture:** Build a connector-based ingestion spine, lead intelligence scoring layer, operational decision engine, local AI governance router, workflow automation engine, and realtime command center on top of the existing Next.js, BullMQ, Redis, Postgres, and worker architecture.

**Tech Stack:** Node.js, TypeScript, Next.js App Router, BullMQ, Redis, Postgres, WebSockets or SSE, Docker, Ollama, Tauri, React Native.

---

## File Structure

Create these new modules:

```text
code/apps/api-gateway/lib/ingestion/
  connector-registry.ts
  normalize-record.ts
  entity-resolution.ts
  ingestion-events.ts

code/apps/api-gateway/app/api/ingestion/
  batch/route.ts
  webhook/[source]/route.ts
  jobs/[id]/route.ts

code/apps/api-gateway/lib/intelligence/
  lead-scoring.ts
  priority-lanes.ts
  qualification-workflow.ts

code/apps/api-gateway/lib/decision/
  operational-decision.ts
  provider-ecosystem.ts
  reputation-brake.ts

code/apps/api-gateway/lib/local-ai/
  ollama-router.ts
  deterministic-fallback.ts
  prompt-governance.ts

code/apps/api-gateway/lib/workflows/
  workflow-types.ts
  workflow-evaluator.ts
  workflow-actions.ts

code/apps/api-gateway/app/api/command-center/
  graph/route.ts

code/workers/
  ingestion-worker/index.ts
  intelligence-worker/index.ts
  workflow-worker/index.ts
```

Modify these existing modules:

```text
code/apps/api-gateway/scripts/init-db.ts
code/apps/api-gateway/lib/daily-outbound.ts
code/apps/api-gateway/lib/outbound-cycle-worker.ts
code/workers/sender-worker/index.ts
code/workers/inbound-worker/index.ts
code/apps/api-gateway/app/(dashboard)/dashboard/page.tsx
code/apps/api-gateway/app/(dashboard)/sent/page.tsx
code/apps/api-gateway/app/(dashboard)/inbox/page.tsx
scripts/render-start.sh
```

---

## Task 1: Database Schema Foundation

**Files:**
- Modify: `code/apps/api-gateway/scripts/init-db.ts`
- Test: `code/apps/api-gateway/scripts/test-autonomous-schema.ts`

- [ ] **Step 1: Add failing schema smoke test**

Create `code/apps/api-gateway/scripts/test-autonomous-schema.ts`:

```ts
import { execute } from '../lib/db'

const tables = [
  'source_connections',
  'ingestion_jobs',
  'raw_source_records',
  'lead_intelligence_scores',
  'operational_decisions',
  'conversation_intelligence',
  'workflow_definitions',
  'governance_evidence'
]

async function main() {
  for (const table of tables) {
    const result = await execute(
      `select to_regclass($1) as table_name`,
      [`public.${table}`]
    )
    if (!result.rows[0]?.table_name) {
      throw new Error(`missing_table:${table}`)
    }
  }
  console.log('autonomous schema ok')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
```

- [ ] **Step 2: Run test and verify it fails before schema exists**

```bash
pnpm --dir code/apps/api-gateway exec tsx scripts/test-autonomous-schema.ts
```

Expected failure:

```text
missing_table:source_connections
```

- [ ] **Step 3: Add schema block**

Add this SQL block inside the database initialization flow in `code/apps/api-gateway/scripts/init-db.ts`:

```sql
CREATE TABLE IF NOT EXISTS source_connections (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  source_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  auth_type TEXT NOT NULL DEFAULT 'api_key',
  encrypted_credentials TEXT,
  source_trust NUMERIC NOT NULL DEFAULT 0.5,
  rate_limit_per_minute INT NOT NULL DEFAULT 60,
  cursor TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, source_type)
);

CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id BIGINT NOT NULL,
  source_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  accepted_count INT NOT NULL DEFAULT 0,
  normalized_count INT NOT NULL DEFAULT 0,
  rejected_count INT NOT NULL DEFAULT 0,
  error_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, source_type, idempotency_key)
);

CREATE TABLE IF NOT EXISTS raw_source_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id BIGINT NOT NULL,
  ingestion_job_id UUID REFERENCES ingestion_jobs(id),
  source_type TEXT NOT NULL,
  external_id TEXT,
  payload_hash TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, source_type, external_id)
);

CREATE TABLE IF NOT EXISTS lead_intelligence_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id BIGINT NOT NULL,
  prospect_id UUID NOT NULL,
  outbound_readiness NUMERIC NOT NULL,
  infrastructure_maturity NUMERIC NOT NULL,
  deliverability_risk NUMERIC NOT NULL,
  agency_fit NUMERIC NOT NULL,
  enterprise_value NUMERIC NOT NULL,
  ai_governance_fit NUMERIC NOT NULL,
  licensing_probability NUMERIC NOT NULL,
  priority_lane TEXT NOT NULL,
  reasons JSONB NOT NULL DEFAULT '[]',
  scored_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operational_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id BIGINT NOT NULL,
  prospect_id UUID,
  action TEXT NOT NULL,
  lane TEXT NOT NULL,
  provider TEXT,
  sender_identity TEXT,
  send_after TIMESTAMPTZ,
  risk_score NUMERIC NOT NULL,
  reasons JSONB NOT NULL DEFAULT '[]',
  audit_trace_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id BIGINT NOT NULL,
  prospect_id UUID,
  message_id TEXT,
  from_email TEXT NOT NULL,
  subject TEXT,
  classification TEXT NOT NULL,
  opportunity_score NUMERIC NOT NULL DEFAULT 0,
  summary TEXT,
  recommended_action TEXT,
  evidence JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, message_id)
);

CREATE TABLE IF NOT EXISTS workflow_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id BIGINT NOT NULL,
  name TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  enabled BOOLEAN NOT NULL DEFAULT false,
  trigger_type TEXT NOT NULL,
  definition JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS governance_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id BIGINT NOT NULL,
  trace_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_raw_source_records_tenant_source
  ON raw_source_records (tenant_id, source_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_scores_tenant_lane
  ON lead_intelligence_scores (tenant_id, priority_lane, scored_at DESC);

CREATE INDEX IF NOT EXISTS idx_operational_decisions_tenant_action
  ON operational_decisions (tenant_id, action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversation_intelligence_tenant_class
  ON conversation_intelligence (tenant_id, classification, created_at DESC);
```

- [ ] **Step 4: Apply schema and verify**

```bash
pnpm --dir code/apps/api-gateway db:init
pnpm --dir code/apps/api-gateway exec tsx scripts/test-autonomous-schema.ts
```

Expected output:

```text
autonomous schema ok
```

- [ ] **Step 5: Typecheck**

```bash
pnpm --dir code/apps/api-gateway exec tsc --noEmit --pretty false
```

Expected: no TypeScript errors.

---

## Task 2: Connector Registry

**Files:**
- Create: `code/apps/api-gateway/lib/ingestion/connector-registry.ts`
- Test: `code/apps/api-gateway/scripts/test-connector-registry.ts`

- [ ] **Step 1: Add registry test**

Create `code/apps/api-gateway/scripts/test-connector-registry.ts`:

```ts
import { getConnectorDefinition, listConnectorDefinitions } from '../lib/ingestion/connector-registry'

const required = [
  'apollo',
  'hubspot',
  'salesforce',
  'smartlead',
  'instantly',
  'linkedin_enrichment',
  'website_research',
  'webhook',
  'rest',
  'csv'
]

for (const source of required) {
  const connector = getConnectorDefinition(source)
  if (!connector) throw new Error(`missing_connector:${source}`)
  if (connector.sourceTrust <= 0 || connector.sourceTrust > 1) {
    throw new Error(`invalid_source_trust:${source}`)
  }
}

if (listConnectorDefinitions().length < required.length) {
  throw new Error('connector_list_too_small')
}

console.log('connector registry ok')
```

- [ ] **Step 2: Implement registry**

Create `code/apps/api-gateway/lib/ingestion/connector-registry.ts`:

```ts
export type ConnectorSource =
  | 'apollo'
  | 'hubspot'
  | 'salesforce'
  | 'smartlead'
  | 'instantly'
  | 'linkedin_enrichment'
  | 'website_research'
  | 'webhook'
  | 'rest'
  | 'csv'

export type ConnectorDefinition = {
  source: ConnectorSource
  label: string
  authType: 'api_key' | 'oauth' | 'signed_webhook' | 'none'
  supportsPull: boolean
  supportsWebhook: boolean
  sourceTrust: number
  defaultRateLimitPerMinute: number
  entityTypes: Array<'prospect' | 'company' | 'campaign' | 'conversation'>
}

const definitions: ConnectorDefinition[] = [
  { source: 'apollo', label: 'Apollo', authType: 'api_key', supportsPull: true, supportsWebhook: false, sourceTrust: 0.72, defaultRateLimitPerMinute: 30, entityTypes: ['prospect', 'company'] },
  { source: 'hubspot', label: 'HubSpot', authType: 'oauth', supportsPull: true, supportsWebhook: true, sourceTrust: 0.95, defaultRateLimitPerMinute: 60, entityTypes: ['prospect', 'company', 'conversation'] },
  { source: 'salesforce', label: 'Salesforce', authType: 'oauth', supportsPull: true, supportsWebhook: true, sourceTrust: 0.96, defaultRateLimitPerMinute: 60, entityTypes: ['prospect', 'company', 'conversation'] },
  { source: 'smartlead', label: 'Smartlead', authType: 'api_key', supportsPull: true, supportsWebhook: true, sourceTrust: 0.78, defaultRateLimitPerMinute: 45, entityTypes: ['prospect', 'campaign', 'conversation'] },
  { source: 'instantly', label: 'Instantly', authType: 'api_key', supportsPull: true, supportsWebhook: true, sourceTrust: 0.78, defaultRateLimitPerMinute: 45, entityTypes: ['prospect', 'campaign', 'conversation'] },
  { source: 'linkedin_enrichment', label: 'LinkedIn Enrichment', authType: 'none', supportsPull: false, supportsWebhook: false, sourceTrust: 0.65, defaultRateLimitPerMinute: 10, entityTypes: ['prospect', 'company'] },
  { source: 'website_research', label: 'Website Research', authType: 'none', supportsPull: true, supportsWebhook: false, sourceTrust: 0.6, defaultRateLimitPerMinute: 12, entityTypes: ['company'] },
  { source: 'webhook', label: 'Signed Webhook', authType: 'signed_webhook', supportsPull: false, supportsWebhook: true, sourceTrust: 0.82, defaultRateLimitPerMinute: 120, entityTypes: ['prospect', 'company', 'campaign', 'conversation'] },
  { source: 'rest', label: 'REST API', authType: 'api_key', supportsPull: false, supportsWebhook: false, sourceTrust: 0.8, defaultRateLimitPerMinute: 120, entityTypes: ['prospect', 'company', 'campaign', 'conversation'] },
  { source: 'csv', label: 'CSV Fallback', authType: 'none', supportsPull: false, supportsWebhook: false, sourceTrust: 0.45, defaultRateLimitPerMinute: 10, entityTypes: ['prospect', 'company'] }
]

export function listConnectorDefinitions(): ConnectorDefinition[] {
  return definitions
}

export function getConnectorDefinition(source: string): ConnectorDefinition | undefined {
  return definitions.find((definition) => definition.source === source)
}
```

- [ ] **Step 3: Verify**

```bash
pnpm --dir code/apps/api-gateway exec tsx scripts/test-connector-registry.ts
```

Expected:

```text
connector registry ok
```

---

## Task 3: Normalization Layer

**Files:**
- Create: `code/apps/api-gateway/lib/ingestion/normalize-record.ts`
- Test: `code/apps/api-gateway/scripts/test-normalize-record.ts`

- [ ] **Step 1: Add normalization test**

Create `code/apps/api-gateway/scripts/test-normalize-record.ts`:

```ts
import { normalizeSourceRecord } from '../lib/ingestion/normalize-record'

const normalized = normalizeSourceRecord({
  tenantId: '1',
  source: 'hubspot',
  externalId: 'contact-123',
  record: {
    email: ' Founder@Example.COM ',
    firstName: 'Asha',
    lastName: 'Rao',
    title: 'Founder',
    company: {
      name: 'Northstar RevOps',
      domain: 'https://www.northstar.example/path'
    },
    evidence: [{ type: 'crm_owned', url: 'https://hubspot.example/contact-123' }]
  },
  sourceTrust: 0.95,
  rawRecordId: 'raw_123'
})

if (normalized.normalizedEmail !== 'founder@example.com') {
  throw new Error(`bad_email:${normalized.normalizedEmail}`)
}

if (normalized.companyDomain !== 'northstar.example') {
  throw new Error(`bad_domain:${normalized.companyDomain}`)
}

if (normalized.seniority !== 'founder') {
  throw new Error(`bad_seniority:${normalized.seniority}`)
}

console.log('normalize record ok')
```

- [ ] **Step 2: Implement normalizer**

Create `code/apps/api-gateway/lib/ingestion/normalize-record.ts`:

```ts
import { URL } from 'node:url'

export type NormalizedSourceRecordInput = {
  tenantId: string
  source: string
  externalId: string
  sourceTrust: number
  rawRecordId: string
  record: Record<string, any>
}

export type CanonicalProspectRecord = {
  tenantId: string
  source: string
  externalId: string
  email: string
  normalizedEmail: string
  firstName?: string
  lastName?: string
  title?: string
  seniority: 'founder' | 'executive' | 'director' | 'manager' | 'operator' | 'unknown'
  companyName?: string
  companyDomain?: string
  sourceTrust: number
  evidence: Array<{ type: string; url?: string; observedAt: string }>
  rawRecordId: string
}

export function normalizeSourceRecord(input: NormalizedSourceRecordInput): CanonicalProspectRecord {
  const email = String(input.record.email ?? '').trim()
  const normalizedEmail = email.toLowerCase()

  if (!normalizedEmail || normalizedEmail.includes('u003e') || !normalizedEmail.includes('@')) {
    throw new Error('invalid_email_artifact')
  }

  const title = optionalString(input.record.title)
  const company = input.record.company && typeof input.record.company === 'object' ? input.record.company : {}

  return {
    tenantId: input.tenantId,
    source: input.source,
    externalId: input.externalId,
    email,
    normalizedEmail,
    firstName: optionalString(input.record.firstName),
    lastName: optionalString(input.record.lastName),
    title,
    seniority: inferSeniority(title),
    companyName: optionalString(company.name ?? input.record.companyName),
    companyDomain: normalizeDomain(company.domain ?? input.record.companyDomain),
    sourceTrust: input.sourceTrust,
    evidence: normalizeEvidence(input.record.evidence),
    rawRecordId: input.rawRecordId
  }
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function inferSeniority(title?: string): CanonicalProspectRecord['seniority'] {
  const value = (title ?? '').toLowerCase()
  if (value.includes('founder') || value.includes('owner')) return 'founder'
  if (value.includes('chief') || value.includes('ceo') || value.includes('cto') || value.includes('vp ')) return 'executive'
  if (value.includes('director') || value.includes('head of')) return 'director'
  if (value.includes('manager') || value.includes('lead')) return 'manager'
  if (value.length > 0) return 'operator'
  return 'unknown'
}

function normalizeDomain(value: unknown): string | undefined {
  const raw = optionalString(value)
  if (!raw) return undefined
  try {
    const withProtocol = raw.startsWith('http') ? raw : `https://${raw}`
    const url = new URL(withProtocol)
    return url.hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return raw.replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase()
  }
}

function normalizeEvidence(value: unknown): CanonicalProspectRecord['evidence'] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item: any) => ({
      type: String(item.type ?? 'unknown'),
      url: optionalString(item.url),
      observedAt: new Date().toISOString()
    }))
}
```

- [ ] **Step 3: Verify**

```bash
pnpm --dir code/apps/api-gateway exec tsx scripts/test-normalize-record.ts
```

Expected:

```text
normalize record ok
```

---

## Task 4: Lead Scoring Engine

**Files:**
- Create: `code/apps/api-gateway/lib/intelligence/lead-scoring.ts`
- Test: `code/apps/api-gateway/scripts/test-lead-scoring.ts`

- [ ] **Step 1: Add scoring test**

Create `code/apps/api-gateway/scripts/test-lead-scoring.ts`:

```ts
import { scoreLeadIntelligence } from '../lib/intelligence/lead-scoring'

const score = scoreLeadIntelligence({
  emailQuality: 1,
  evidenceQuality: 0.9,
  companyDomainQuality: 1,
  roleRelevance: 1,
  sourceTrust: 0.95,
  priorEngagementSignal: 0,
  employeeCountFit: 0.8,
  technicalStackSignal: 0.7,
  outboundOperationsSignal: 1,
  complianceLanguageSignal: 0.5,
  multiProviderSignal: 0.6,
  revenueStageSignal: 0.7,
  validationUncertainty: 0.1,
  roleInboxRisk: 0.1,
  previousBounceHistory: 0,
  domainMxRisk: 0,
  catchAllRisk: 0.2,
  sourceQualityRisk: 0.1,
  agencyCategoryMatch: 1,
  outboundServiceSignal: 1,
  multiClientSignal: 0.9,
  whiteLabelFit: 0.9,
  commercialCapacity: 0.8,
  budgetCapacitySignal: 0.8,
  strategicPainSignal: 0.8,
  governanceNeed: 0.7,
  urgencySignal: 0.4,
  aiProductSignal: 0.4,
  securitySignal: 0.5,
  dataSensitivitySignal: 0.5,
  auditNeedSignal: 0.6,
  localAiNeed: 0.4,
  complianceSignal: 0.5,
  decisionMakerRelevance: 1,
  painIntensity: 0.8
})

if (score.priorityLane !== 'white_label_priority') {
  throw new Error(`bad_lane:${score.priorityLane}`)
}

if (score.licensingProbability <= 0.6) {
  throw new Error(`licensing_probability_too_low:${score.licensingProbability}`)
}

console.log('lead scoring ok')
```

- [ ] **Step 2: Implement scoring**

Create `code/apps/api-gateway/lib/intelligence/lead-scoring.ts`:

```ts
export type LeadScoringInput = Record<string, number>

export type LeadScoringOutput = {
  outboundReadiness: number
  infrastructureMaturity: number
  deliverabilityRisk: number
  agencyFit: number
  enterpriseValue: number
  aiGovernanceFit: number
  licensingProbability: number
  priorityLane: 'white_label_priority' | 'enterprise_internal' | 'audit_first' | 'enrich_more' | 'hold' | 'suppress'
  reasons: string[]
}

export function scoreLeadIntelligence(input: LeadScoringInput): LeadScoringOutput {
  const outboundReadiness = weighted([
    [input.emailQuality, 0.25],
    [input.evidenceQuality, 0.20],
    [input.companyDomainQuality, 0.15],
    [input.roleRelevance, 0.15],
    [input.sourceTrust, 0.15],
    [input.priorEngagementSignal, 0.10]
  ])

  const infrastructureMaturity = weighted([
    [input.employeeCountFit, 0.20],
    [input.technicalStackSignal, 0.20],
    [input.outboundOperationsSignal, 0.20],
    [input.complianceLanguageSignal, 0.15],
    [input.multiProviderSignal, 0.15],
    [input.revenueStageSignal, 0.10]
  ])

  const deliverabilityRisk = weighted([
    [input.validationUncertainty, 0.30],
    [input.roleInboxRisk, 0.20],
    [input.previousBounceHistory, 0.15],
    [input.domainMxRisk, 0.15],
    [input.catchAllRisk, 0.10],
    [input.sourceQualityRisk, 0.10]
  ])

  const agencyFit = weighted([
    [input.agencyCategoryMatch, 0.25],
    [input.outboundServiceSignal, 0.25],
    [input.multiClientSignal, 0.20],
    [input.whiteLabelFit, 0.15],
    [input.commercialCapacity, 0.15]
  ])

  const enterpriseValue = weighted([
    [input.employeeCountFit, 0.25],
    [input.budgetCapacitySignal, 0.20],
    [input.strategicPainSignal, 0.20],
    [input.governanceNeed, 0.15],
    [input.urgencySignal, 0.10],
    [input.sourceTrust, 0.10]
  ])

  const aiGovernanceFit = weighted([
    [input.aiProductSignal, 0.25],
    [input.securitySignal, 0.20],
    [input.dataSensitivitySignal, 0.20],
    [input.auditNeedSignal, 0.15],
    [input.localAiNeed, 0.10],
    [input.complianceSignal, 0.10]
  ])

  const licensingProbability = clamp(
    0.25 * enterpriseValue +
    0.20 * Math.max(agencyFit, aiGovernanceFit) +
    0.20 * infrastructureMaturity +
    0.15 * outboundReadiness +
    0.10 * value(input.decisionMakerRelevance) +
    0.10 * value(input.painIntensity) -
    0.15 * deliverabilityRisk
  )

  const priorityLane = choosePriorityLane({
    outboundReadiness,
    deliverabilityRisk,
    agencyFit,
    enterpriseValue,
    aiGovernanceFit,
    licensingProbability
  })

  return {
    outboundReadiness,
    infrastructureMaturity,
    deliverabilityRisk,
    agencyFit,
    enterpriseValue,
    aiGovernanceFit,
    licensingProbability,
    priorityLane,
    reasons: buildReasons({ outboundReadiness, infrastructureMaturity, deliverabilityRisk, agencyFit, enterpriseValue, aiGovernanceFit, licensingProbability })
  }
}

function weighted(items: Array<[number | undefined, number]>): number {
  return clamp(items.reduce((sum, [item, weight]) => sum + value(item) * weight, 0))
}

function value(input: number | undefined): number {
  if (!Number.isFinite(input)) return 0
  return clamp(input)
}

function clamp(input: number): number {
  return Math.max(0, Math.min(1, Number(input.toFixed(4))))
}

function choosePriorityLane(input: Pick<LeadScoringOutput, 'outboundReadiness' | 'deliverabilityRisk' | 'agencyFit' | 'enterpriseValue' | 'aiGovernanceFit' | 'licensingProbability'>): LeadScoringOutput['priorityLane'] {
  if (input.deliverabilityRisk >= 0.75) return 'suppress'
  if (input.outboundReadiness < 0.45) return 'enrich_more'
  if (input.agencyFit >= 0.75 && input.licensingProbability >= 0.6) return 'white_label_priority'
  if ((input.enterpriseValue >= 0.7 || input.aiGovernanceFit >= 0.7) && input.licensingProbability >= 0.55) return 'enterprise_internal'
  if (input.licensingProbability >= 0.45) return 'audit_first'
  return 'hold'
}

function buildReasons(input: Record<string, number>): string[] {
  return Object.entries(input)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([key, score]) => `${key}:${score}`)
}
```

- [ ] **Step 3: Verify**

```bash
pnpm --dir code/apps/api-gateway exec tsx scripts/test-lead-scoring.ts
```

Expected:

```text
lead scoring ok
```

---

## Task 5: Operational Decision Engine

**Files:**
- Create: `code/apps/api-gateway/lib/decision/operational-decision.ts`
- Test: `code/apps/api-gateway/scripts/test-operational-decision.ts`

- [ ] **Step 1: Add decision test**

Create `code/apps/api-gateway/scripts/test-operational-decision.ts`:

```ts
import { evaluateOperationalDecision } from '../lib/decision/operational-decision'

const base = {
  tenantId: '1',
  prospectId: 'prospect_1',
  scores: {
    outboundReadiness: 0.9,
    licensingProbability: 0.8,
    deliverabilityRisk: 0.2,
    agencyFit: 0.8,
    aiGovernanceFit: 0.5
  },
  email: { address: 'founder@example.com', verdict: 'valid' as const },
  suppression: { suppressed: false },
  domainHealth: {
    spfValid: true,
    dkimValid: true,
    dmarcValid: true,
    bounceRate24h: 0,
    failureRate24h: 0,
    remainingCapacity: 5
  },
  providerHealth: [
    { provider: 'resend', available: true, failureRate24h: 0, remainingCapacity: 5 }
  ]
}

const sendDecision = evaluateOperationalDecision(base)
if (sendDecision.action !== 'send') throw new Error(`expected_send:${sendDecision.action}`)

const suppressedDecision = evaluateOperationalDecision({
  ...base,
  suppression: { suppressed: true, reason: 'unsubscribe' }
})
if (suppressedDecision.action !== 'stop_sequence') {
  throw new Error(`expected_stop:${suppressedDecision.action}`)
}

console.log('operational decision ok')
```

- [ ] **Step 2: Implement decision engine**

Create `code/apps/api-gateway/lib/decision/operational-decision.ts`:

```ts
export type OperationalDecisionInput = {
  tenantId: string
  prospectId: string
  scores: {
    outboundReadiness: number
    licensingProbability: number
    deliverabilityRisk: number
    agencyFit: number
    aiGovernanceFit: number
  }
  email: {
    address: string
    verdict: 'valid' | 'risky' | 'invalid' | 'unknown'
  }
  suppression: {
    suppressed: boolean
    reason?: string
  }
  domainHealth: {
    spfValid: boolean
    dkimValid: boolean
    dmarcValid: boolean
    bounceRate24h: number
    failureRate24h: number
    remainingCapacity: number
  }
  providerHealth: Array<{
    provider: string
    available: boolean
    failureRate24h: number
    remainingCapacity: number
  }>
}

export type OperationalDecisionOutput = {
  action: 'send' | 'defer' | 'review' | 'drop' | 'stop_sequence'
  lane: 'standard' | 'low_risk' | 'recovery' | 'manual_review'
  provider?: string
  sendAfter?: string
  reasons: string[]
  riskScore: number
  auditTraceId: string
}

export function evaluateOperationalDecision(input: OperationalDecisionInput): OperationalDecisionOutput {
  const traceId = crypto.randomUUID()

  if (input.suppression.suppressed) {
    return decision('stop_sequence', 'manual_review', ['suppressed', input.suppression.reason ?? 'policy'], 1, traceId)
  }

  if (input.email.verdict === 'invalid') {
    return decision('drop', 'manual_review', ['invalid_email'], 1, traceId)
  }

  if (!input.domainHealth.spfValid || !input.domainHealth.dkimValid) {
    return decision('review', 'manual_review', ['domain_authentication_incomplete'], 0.8, traceId)
  }

  if (input.domainHealth.bounceRate24h >= 0.03 || input.domainHealth.failureRate24h >= 0.08) {
    return decision('defer', 'recovery', ['domain_pressure'], 0.75, traceId, oneHourFromNow())
  }

  if (input.domainHealth.remainingCapacity <= 0) {
    return decision('defer', 'standard', ['capacity_exhausted'], 0.4, traceId, oneHourFromNow())
  }

  if (input.scores.deliverabilityRisk >= 0.7) {
    return decision('review', 'manual_review', ['deliverability_risk_high'], input.scores.deliverabilityRisk, traceId)
  }

  if (input.scores.outboundReadiness < 0.45) {
    return decision('review', 'manual_review', ['readiness_too_low'], 0.6, traceId)
  }

  const provider = input.providerHealth
    .filter((item) => item.available && item.remainingCapacity > 0)
    .sort((a, b) => a.failureRate24h - b.failureRate24h)[0]

  if (!provider) {
    return decision('defer', 'standard', ['no_provider_capacity'], 0.5, traceId, oneHourFromNow())
  }

  const lane = input.email.verdict === 'risky' ? 'low_risk' : 'standard'
  return {
    action: 'send',
    lane,
    provider: provider.provider,
    reasons: ['verified', 'capacity_available', 'policy_allowed'],
    riskScore: input.scores.deliverabilityRisk,
    auditTraceId: traceId
  }
}

function decision(
  action: OperationalDecisionOutput['action'],
  lane: OperationalDecisionOutput['lane'],
  reasons: string[],
  riskScore: number,
  auditTraceId: string,
  sendAfter?: string
): OperationalDecisionOutput {
  return { action, lane, reasons, riskScore, auditTraceId, sendAfter }
}

function oneHourFromNow(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString()
}
```

- [ ] **Step 3: Verify**

```bash
pnpm --dir code/apps/api-gateway exec tsx scripts/test-operational-decision.ts
```

Expected:

```text
operational decision ok
```

---

## Task 6: Ollama-First Local AI Router

**Files:**
- Create: `code/apps/api-gateway/lib/local-ai/deterministic-fallback.ts`
- Create: `code/apps/api-gateway/lib/local-ai/ollama-router.ts`
- Test: `code/apps/api-gateway/scripts/test-local-ai-router.ts`

- [ ] **Step 1: Add local AI router test**

Create `code/apps/api-gateway/scripts/test-local-ai-router.ts`:

```ts
import { classifyReplyDeterministically } from '../lib/local-ai/deterministic-fallback'

const interested = classifyReplyDeterministically('Can you send pricing and a demo link?')
if (interested.classification !== 'pricing_interest') {
  throw new Error(`bad_interested:${interested.classification}`)
}

const dsn = classifyReplyDeterministically('Delivery Status Notification Failure recipient address rejected')
if (dsn.classification !== 'bounce_or_dsn') {
  throw new Error(`bad_dsn:${dsn.classification}`)
}

console.log('local ai router fallback ok')
```

- [ ] **Step 2: Implement deterministic fallback**

Create `code/apps/api-gateway/lib/local-ai/deterministic-fallback.ts`:

```ts
export type ReplyClassification =
  | 'interested'
  | 'pricing_interest'
  | 'partnership_interest'
  | 'licensing_interest'
  | 'objection'
  | 'not_interested'
  | 'unsubscribe'
  | 'bounce_or_dsn'
  | 'auto_reply'
  | 'neutral'

export function classifyReplyDeterministically(text: string): { classification: ReplyClassification; reasons: string[] } {
  const value = text.toLowerCase()

  if (match(value, ['delivery status notification', 'undeliverable', 'recipient address rejected', 'does not exist'])) {
    return { classification: 'bounce_or_dsn', reasons: ['dsn_pattern'] }
  }

  if (match(value, ['unsubscribe', 'remove me', 'do not contact', 'stop emailing'])) {
    return { classification: 'unsubscribe', reasons: ['unsubscribe_pattern'] }
  }

  if (match(value, ['pricing', 'cost', 'license price', 'how much'])) {
    return { classification: 'pricing_interest', reasons: ['pricing_pattern'] }
  }

  if (match(value, ['white label', 'reseller', 'partner', 'partnership'])) {
    return { classification: 'partnership_interest', reasons: ['partnership_pattern'] }
  }

  if (match(value, ['license', 'commercial rights', 'deployment rights'])) {
    return { classification: 'licensing_interest', reasons: ['licensing_pattern'] }
  }

  if (match(value, ['demo', 'call', 'meeting', 'send details', 'interested'])) {
    return { classification: 'interested', reasons: ['interest_pattern'] }
  }

  if (match(value, ['not interested', 'no thanks', 'not a fit'])) {
    return { classification: 'not_interested', reasons: ['negative_pattern'] }
  }

  if (match(value, ['out of office', 'automatic reply', 'auto-reply'])) {
    return { classification: 'auto_reply', reasons: ['auto_reply_pattern'] }
  }

  if (match(value, ['already use', 'too expensive', 'no budget', 'build internally'])) {
    return { classification: 'objection', reasons: ['objection_pattern'] }
  }

  return { classification: 'neutral', reasons: ['no_strong_pattern'] }
}

function match(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern))
}
```

- [ ] **Step 3: Implement Ollama router**

Create `code/apps/api-gateway/lib/local-ai/ollama-router.ts`:

```ts
import { classifyReplyDeterministically, ReplyClassification } from './deterministic-fallback'

export type LocalAiResult = {
  classification: ReplyClassification
  reasons: string[]
  provider: 'ollama' | 'deterministic'
}

export async function classifyReplyLocalFirst(text: string): Promise<LocalAiResult> {
  const baseUrl = process.env.OLLAMA_BASE_URL
  const model = process.env.OLLAMA_REPLY_MODEL ?? 'llama3.1:8b'

  if (!baseUrl) {
    const fallback = classifyReplyDeterministically(text)
    return { ...fallback, provider: 'deterministic' }
  }

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        prompt: `Classify this B2B reply as one label only: interested, pricing_interest, partnership_interest, licensing_interest, objection, not_interested, unsubscribe, bounce_or_dsn, auto_reply, neutral.\n\nReply:\n${text}`
      }),
      signal: AbortSignal.timeout(3000)
    })

    const data = await response.json() as { response?: string }
    const label = String(data.response ?? '').trim().toLowerCase() as ReplyClassification
    const allowed: ReplyClassification[] = ['interested', 'pricing_interest', 'partnership_interest', 'licensing_interest', 'objection', 'not_interested', 'unsubscribe', 'bounce_or_dsn', 'auto_reply', 'neutral']

    if (allowed.includes(label)) {
      return { classification: label, reasons: ['ollama_label'], provider: 'ollama' }
    }
  } catch {
    const fallback = classifyReplyDeterministically(text)
    return { ...fallback, provider: 'deterministic' }
  }

  const fallback = classifyReplyDeterministically(text)
  return { ...fallback, provider: 'deterministic' }
}
```

- [ ] **Step 4: Verify deterministic path**

```bash
pnpm --dir code/apps/api-gateway exec tsx scripts/test-local-ai-router.ts
```

Expected:

```text
local ai router fallback ok
```

---

## Task 7: Workflow Engine Foundation

**Files:**
- Create: `code/apps/api-gateway/lib/workflows/workflow-types.ts`
- Create: `code/apps/api-gateway/lib/workflows/workflow-evaluator.ts`
- Test: `code/apps/api-gateway/scripts/test-workflow-evaluator.ts`

- [ ] **Step 1: Add workflow evaluator test**

Create `code/apps/api-gateway/scripts/test-workflow-evaluator.ts`:

```ts
import { evaluateWorkflow } from '../lib/workflows/workflow-evaluator'

const result = evaluateWorkflow({
  event: {
    type: 'conversation.classified',
    payload: { classification: 'pricing_interest', opportunityScore: 0.8 }
  },
  workflow: {
    id: 'wf_1',
    tenantId: '1',
    name: 'Escalate pricing replies',
    version: 1,
    enabled: true,
    trigger: { eventType: 'conversation.classified', filters: {} },
    conditions: [{ field: 'classification', operator: 'eq', value: 'pricing_interest' }],
    actions: [{ type: 'notify_operator', input: { channel: 'telegram' } }],
    rollbackActions: []
  }
})

if (!result.matched || result.actions.length !== 1) {
  throw new Error('workflow_did_not_match')
}

console.log('workflow evaluator ok')
```

- [ ] **Step 2: Implement workflow types**

Create `code/apps/api-gateway/lib/workflows/workflow-types.ts`:

```ts
export type WorkflowEvent = {
  type: string
  payload: Record<string, unknown>
}

export type WorkflowCondition = {
  field: string
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains'
  value: unknown
}

export type WorkflowAction = {
  type: string
  input: Record<string, unknown>
}

export type WorkflowDefinition = {
  id: string
  tenantId: string
  name: string
  version: number
  enabled: boolean
  trigger: {
    eventType: string
    filters: Record<string, unknown>
  }
  conditions: WorkflowCondition[]
  actions: WorkflowAction[]
  rollbackActions: WorkflowAction[]
}
```

- [ ] **Step 3: Implement evaluator**

Create `code/apps/api-gateway/lib/workflows/workflow-evaluator.ts`:

```ts
import { WorkflowAction, WorkflowDefinition, WorkflowEvent } from './workflow-types'

export function evaluateWorkflow(input: { event: WorkflowEvent; workflow: WorkflowDefinition }): { matched: boolean; actions: WorkflowAction[]; reasons: string[] } {
  const { event, workflow } = input

  if (!workflow.enabled) return { matched: false, actions: [], reasons: ['workflow_disabled'] }
  if (workflow.trigger.eventType !== event.type) return { matched: false, actions: [], reasons: ['trigger_mismatch'] }

  for (const condition of workflow.conditions) {
    const actual = event.payload[condition.field]
    if (!evaluateCondition(actual, condition.operator, condition.value)) {
      return { matched: false, actions: [], reasons: [`condition_failed:${condition.field}`] }
    }
  }

  return { matched: true, actions: workflow.actions, reasons: ['matched'] }
}

function evaluateCondition(actual: unknown, operator: string, expected: unknown): boolean {
  if (operator === 'eq') return actual === expected
  if (operator === 'neq') return actual !== expected
  if (operator === 'contains') return String(actual ?? '').includes(String(expected ?? ''))

  const left = Number(actual)
  const right = Number(expected)
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false
  if (operator === 'gt') return left > right
  if (operator === 'gte') return left >= right
  if (operator === 'lt') return left < right
  if (operator === 'lte') return left <= right
  return false
}
```

- [ ] **Step 4: Verify**

```bash
pnpm --dir code/apps/api-gateway exec tsx scripts/test-workflow-evaluator.ts
```

Expected:

```text
workflow evaluator ok
```

---

## Task 8: Command Center Graph API

**Files:**
- Create: `code/apps/api-gateway/app/api/command-center/graph/route.ts`
- Test: `code/apps/api-gateway/scripts/test-command-center-graph.ts`

- [ ] **Step 1: Add command-center response contract test**

Create `code/apps/api-gateway/scripts/test-command-center-graph.ts`:

```ts
const required = ['ingestion', 'intelligence', 'decisions', 'delivery', 'conversations', 'governance']

async function main() {
  const baseUrl = process.env.TEST_BASE_URL ?? 'http://localhost:3000'
  const response = await fetch(`${baseUrl}/api/command-center/graph`)
  if (!response.ok) throw new Error(`http_${response.status}`)
  const data = await response.json()
  for (const key of required) {
    if (!(key in data)) throw new Error(`missing_key:${key}`)
  }
  console.log('command center graph ok')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
```

- [ ] **Step 2: Implement route**

Create `code/apps/api-gateway/app/api/command-center/graph/route.ts`:

```ts
import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    ingestion: { queued: 0, active: 0, failed: 0 },
    intelligence: { scoredToday: 0, decisionReady: 0 },
    decisions: { send: 0, defer: 0, review: 0, drop: 0 },
    delivery: { sentToday: 0, failedToday: 0, bouncedToday: 0 },
    conversations: { repliesToday: 0, interested: 0, licensing: 0 },
    governance: { policyBlocksToday: 0, evidenceEventsToday: 0 }
  })
}
```

- [ ] **Step 3: Replace placeholder counts with real queries**

After the route contract is live, replace each zero with compact aggregate queries against:

```text
ingestion_jobs
lead_intelligence_scores
operational_decisions
events
conversation_intelligence
governance_evidence
```

Use `Promise.allSettled` so one slow subsystem does not break the command center.

- [ ] **Step 4: Verify route in local app**

```bash
pnpm --dir code/apps/api-gateway dev
TEST_BASE_URL=http://localhost:3000 pnpm --dir code/apps/api-gateway exec tsx scripts/test-command-center-graph.ts
```

Expected:

```text
command center graph ok
```

---

## Task 9: Runtime Wiring

**Files:**
- Modify: `scripts/render-start.sh`
- Modify: `package.json`
- Create: `code/workers/ingestion-worker/index.ts`
- Create: `code/workers/intelligence-worker/index.ts`
- Create: `code/workers/workflow-worker/index.ts`

- [ ] **Step 1: Add worker package scripts**

Add scripts for:

```json
{
  "worker:ingestion": "pnpm --dir code/workers/ingestion-worker start",
  "worker:intelligence": "pnpm --dir code/workers/intelligence-worker start",
  "worker:workflow": "pnpm --dir code/workers/workflow-worker start"
}
```

- [ ] **Step 2: Add memory-safe worker defaults**

In `scripts/render-start.sh`, default embedded autonomous workers to disabled on small profile:

```bash
WEB_EMBED_INGESTION_WORKER="${WEB_EMBED_INGESTION_WORKER:-false}"
WEB_EMBED_INTELLIGENCE_WORKER="${WEB_EMBED_INTELLIGENCE_WORKER:-false}"
WEB_EMBED_WORKFLOW_WORKER="${WEB_EMBED_WORKFLOW_WORKER:-false}"
```

- [ ] **Step 3: Add worker boot logs**

Add clear logs:

```bash
echo "[render-start] autonomous workers ingestion=$WEB_EMBED_INGESTION_WORKER intelligence=$WEB_EMBED_INTELLIGENCE_WORKER workflow=$WEB_EMBED_WORKFLOW_WORKER"
```

- [ ] **Step 4: Verify Render small profile remains safe**

```bash
MEMORY_PROFILE=small WEB_EMBED_INGESTION_WORKER=false WEB_EMBED_INTELLIGENCE_WORKER=false WEB_EMBED_WORKFLOW_WORKER=false pnpm start
```

Expected:

```text
[render-start] memory_profile=small
```

and no autonomous worker starts unless explicitly enabled.

---

## Task 10: Final Verification

- [ ] **Step 1: Run TypeScript**

```bash
pnpm --dir code/apps/api-gateway exec tsc --noEmit --pretty false
```

Expected: no TypeScript errors.

- [ ] **Step 2: Run autonomous smoke scripts**

```bash
pnpm --dir code/apps/api-gateway exec tsx scripts/test-connector-registry.ts
pnpm --dir code/apps/api-gateway exec tsx scripts/test-normalize-record.ts
pnpm --dir code/apps/api-gateway exec tsx scripts/test-lead-scoring.ts
pnpm --dir code/apps/api-gateway exec tsx scripts/test-operational-decision.ts
pnpm --dir code/apps/api-gateway exec tsx scripts/test-local-ai-router.ts
pnpm --dir code/apps/api-gateway exec tsx scripts/test-workflow-evaluator.ts
```

Expected:

```text
connector registry ok
normalize record ok
lead scoring ok
operational decision ok
local ai router fallback ok
workflow evaluator ok
```

- [ ] **Step 3: Check whitespace**

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add code docs
git commit -m "feat: add autonomous communication operations foundation"
```

---

## Build Order

1. Database schema foundation.
2. Connector registry.
3. Normalization layer.
4. Lead scoring engine.
5. Operational decision engine.
6. Ollama-first local AI router.
7. Workflow engine foundation.
8. Command Center graph API.
9. Runtime wiring.
10. Dashboard upgrades.

This order removes CSV dependency first, then adds intelligence, then adds autonomous orchestration. It avoids destabilizing the sender worker before the platform has enough verified, scored, governed prospects.
