import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseCsvText } from '../lib/ingestion/connectors/csv'
import { getIngestionConnector } from '../lib/ingestion/connectors'
import { recordsAtPath } from '../lib/ingestion/connectors/base'
import { queueForKind } from '../lib/queue/autonomous-queue-client'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

const schema = readFileSync(join(process.cwd(), 'scripts/init-db.sql'), 'utf8')
for (const table of ['worker_heartbeats', 'circuit_breaker_state', 'dead_letter_events', 'crm_sync_events']) {
  assert(schema.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `missing phase2 table ${table}`)
}

const csvRows = parseCsvText('email,name,company\nfounder@example.com,Ava,Example Co\n')
assert(csvRows.length === 1, 'csv parser should parse one row')
assert(csvRows[0]?.email === 'founder@example.com', 'csv parser email mismatch')

const nested = recordsAtPath({ data: { contacts: [{ email: 'one@example.com' }] } }, 'data.contacts')
assert(nested.length === 1 && nested[0]?.email === 'one@example.com', 'recordsAtPath failed')

assert(getIngestionConnector('apollo').sourceType === 'apollo', 'apollo connector missing')
assert(getIngestionConnector('hubspot').sourceType === 'hubspot', 'hubspot connector missing')
assert(getIngestionConnector('salesforce').sourceType === 'salesforce', 'salesforce connector missing')
assert(getIngestionConnector('rest').sourceType === 'rest', 'rest connector missing')
assert(getIngestionConnector('csv').sourceType === 'csv', 'csv connector missing')

assert(queueForKind('ingestion.pull') === 'ingestion', 'ingestion queue routing failed')
assert(queueForKind('crm.sync') === 'workflow', 'crm queue routing failed')
assert(queueForKind('telemetry.sample') === 'telemetry', 'telemetry queue routing failed')

console.log('autonomous ops smoke test passed')
