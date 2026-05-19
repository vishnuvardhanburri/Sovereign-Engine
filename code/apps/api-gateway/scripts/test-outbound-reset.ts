import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import {
  OUTBOUND_RESET_DELETE_STEPS,
  OUTBOUND_RESET_PRESERVED_TABLES,
  buildOutboundResetPreview,
} from '../lib/outbound-reset'
import { GET } from '../app/api/cron/outbound-reset/route'

process.env.CRON_SECRET = 'unit-test-secret'

async function main() {
  const tables = OUTBOUND_RESET_DELETE_STEPS.map((step) => step.table)

  assert(tables.includes('contacts'))
  assert(tables.includes('queue_jobs'))
  assert(tables.includes('events'))
  assert(tables.includes('campaigns'))
  assert(tables.includes('sequences'))
  assert(tables.includes('public_email_evidence'))
  assert(tables.includes('compliant_domain_scans'))
  assert(tables.includes('email_threads'))
  assert(tables.includes('email_validations'))

  assert(!tables.includes('domains'))
  assert(!tables.includes('identities'))
  assert(!tables.includes('suppression_list'))
  assert(!tables.includes('reputation_state'))
  assert(!tables.includes('reputation_events'))

  assert.deepEqual(OUTBOUND_RESET_PRESERVED_TABLES, [
    'clients',
    'domains',
    'identities',
    'suppression_list',
    'reputation_state',
    'reputation_events',
    'domain_pause_events',
  ])

  const preview = buildOutboundResetPreview({
    clientId: 1,
    apply: false,
    dryRun: true,
  })
  assert.equal(preview.clientId, 1)
  assert.equal(preview.apply, false)
  assert.equal(preview.dryRun, true)
  assert.equal(preview.mode, 'safe_outbound_reset')
  assert.equal(preview.requiresApplyParam, true)

  const metadataResponse = await GET(
    new NextRequest('https://sovereign.test/api/cron/outbound-reset')
  )
  assert.equal(metadataResponse.status, 200)
  const metadata = await metadataResponse.json()
  assert.equal(metadata.ok, true)
  assert.equal(metadata.endpoint, 'outbound-reset')

  const invalidSecretResponse = await GET(
    new NextRequest('https://sovereign.test/api/cron/outbound-reset?secret=wrong-secret&dryRun=1')
  )
  assert.equal(invalidSecretResponse.status, 401)

  console.log('outbound reset tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
