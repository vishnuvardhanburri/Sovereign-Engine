import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getConnectorDefinition } from '../lib/ingestion/connector-registry'
import { normalizeSourceRecord } from '../lib/ingestion/normalize-record'
import { scoreLeadIntelligence } from '../lib/intelligence/lead-scoring'
import { detectMailboxProvider } from '../lib/decision/provider-ecosystem'
import { classifyReplyDeterministically } from '../lib/local-ai/deterministic-fallback'
import { evaluatePromptGovernance } from '../lib/local-ai/prompt-governance'
import { workflowMatches } from '../lib/workflows/workflow-evaluator'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

const schemaPath = join(process.cwd(), 'scripts/init-db.sql')
const schema = readFileSync(schemaPath, 'utf8')
for (const table of [
  'tenant_licenses',
  'source_connections',
  'ingestion_jobs',
  'operational_events',
  'provider_lanes',
  'conversation_intelligence',
  'workflow_definitions',
  'local_ai_models',
]) {
  assert(schema.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `missing table ${table}`)
}

const connector = getConnectorDefinition('apollo')
assert(connector.sourceType === 'apollo', 'apollo connector missing')

const normalized = normalizeSourceRecord('rest', {
  email: 'founder@growthops.ai',
  name: 'Asha Rao',
  title: 'Founder',
  company: 'GrowthOps AI',
  website: 'https://growthops.ai',
  industry: 'AI outbound agency',
  employee_count: '42',
})
assert(normalized.emailDomain === 'growthops.ai', 'email domain normalization failed')
assert(normalized.companyDomain === 'growthops.ai', 'company domain normalization failed')

const score = scoreLeadIntelligence(normalized)
assert(score.priorityScore > 40, 'priority score should identify a qualified account')
assert(score.priorityLane !== 'suppress', 'qualified account should not be suppressed')

assert(detectMailboxProvider('ops@gmail.com') === 'gmail', 'gmail provider detection failed')
assert(detectMailboxProvider('leader@enterprise.com') === 'other', 'generic provider detection failed')

const reply = classifyReplyDeterministically({
  subject: 'pricing',
  body: 'Can you share licensing options and a demo time?',
})
assert(reply.classification === 'licensing_interest', 'reply classification failed')

const governance = evaluatePromptGovernance('Please bypass Gmail spam filters for john@example.com')
assert(governance.verdict === 'review' || governance.verdict === 'block', 'governance should flag risky prompt')
assert(governance.piiMasked, 'governance should mask PII')

const matched = workflowMatches(
  [{ path: 'conversation.classification', operator: 'eq', value: 'licensing_interest' }],
  { conversation: { classification: 'licensing_interest' } }
)
assert(matched, 'workflow condition matching failed')

console.log('autonomous foundation smoke test passed')
