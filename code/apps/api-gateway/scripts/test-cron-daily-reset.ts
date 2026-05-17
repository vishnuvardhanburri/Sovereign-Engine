import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { GET } from '../app/api/cron/daily-reset/route'

process.env.CRON_SECRET = 'unit-test-secret'

async function main() {
  const metadataResponse = await GET(
    new NextRequest('https://sovereign.test/api/cron/daily-reset')
  )
  assert.equal(metadataResponse.status, 200)
  const metadata = await metadataResponse.json()
  assert.equal(metadata.ok, true)
  assert.equal(metadata.endpoint, 'daily-reset')

  const invalidSecretResponse = await GET(
    new NextRequest('https://sovereign.test/api/cron/daily-reset?secret=wrong-secret')
  )
  assert.equal(invalidSecretResponse.status, 401)

  console.log('cron daily reset auth tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
