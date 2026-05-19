import assert from 'node:assert/strict'
import {
  mapHunterDomainSearch,
  mapHunterVerification,
  searchDomainWithHunter,
  verifyEmailWithHunter,
} from '../lib/integrations/hunter'

async function main() {
  assert.deepEqual(mapHunterVerification({ result: 'deliverable', score: 97, accept_all: false }), {
    verdict: 'valid',
    score: 0.97,
    catchAll: false,
  })

  assert.deepEqual(mapHunterVerification({ result: 'undeliverable', score: 4, accept_all: false }), {
    verdict: 'invalid',
    score: 0.04,
    catchAll: false,
  })

  assert.deepEqual(mapHunterVerification({ result: 'risky', score: 62, accept_all: true }), {
    verdict: 'risky',
    score: 0.62,
    catchAll: true,
  })

  const noKey = await verifyEmailWithHunter('hello@example.com', { apiKey: '' })
  assert.equal(noKey.verdict, 'unknown')
  assert.equal(noKey.error, 'hunter_not_configured')

  const valid = await verifyEmailWithHunter('hello@example.com', {
    apiKey: 'test-key',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          data: {
            result: 'deliverable',
            score: 91,
            accept_all: false,
            mx_records: true,
            smtp_check: true,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      ),
  })

  assert.equal(valid.verdict, 'valid')
  assert.equal(valid.score, 0.91)
  assert.equal(valid.catchAll, false)
  assert.equal(valid.provider, 'hunter')

  const exhausted = await verifyEmailWithHunter('hello@example.com', {
    apiKey: 'test-key',
    fetchImpl: async () =>
      new Response(JSON.stringify({ errors: [{ details: 'plan limit reached' }] }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
  })

  assert.equal(exhausted.verdict, 'unknown')
  assert.equal(exhausted.error, 'hunter_http_429')

  const mappedDomain = mapHunterDomainSearch({
    data: {
      domain: 'example.com',
      organization: 'Example',
      pattern: '{first}.{last}',
      accept_all: false,
      disposable: false,
      webmail: false,
      emails: [
        {
          value: 'sales@example.com',
          type: 'generic',
          confidence: 93,
          first_name: null,
          last_name: null,
          position: 'Sales',
          department: 'sales',
          seniority: null,
          linkedin: null,
          sources: [
            {
              domain: 'example.com',
              uri: 'https://example.com/contact',
              still_on_page: true,
            },
          ],
        },
      ],
    },
  })

  assert.equal(mappedDomain.domain, 'example.com')
  assert.equal(mappedDomain.organization, 'Example')
  assert.equal(mappedDomain.emails[0]?.value, 'sales@example.com')
  assert.equal(mappedDomain.emails[0]?.confidence, 93)
  assert.equal(mappedDomain.emails[0]?.sources[0]?.uri, 'https://example.com/contact')

  const searchedDomain = await searchDomainWithHunter('example.com', {
    apiKey: 'test-key',
    limit: 3,
    fetchImpl: async (url) => {
      const requestUrl = new URL(String(url))
      assert.equal(requestUrl.pathname, '/v2/domain-search')
      assert.equal(requestUrl.searchParams.get('domain'), 'example.com')
      assert.equal(requestUrl.searchParams.get('limit'), '3')
      return new Response(
        JSON.stringify({
          data: {
            domain: 'example.com',
            organization: 'Example',
            emails: [
              {
                value: 'partnerships@example.com',
                type: 'generic',
                confidence: 88,
                sources: [{ uri: 'https://example.com/partners' }],
              },
            ],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    },
  })

  assert.equal(searchedDomain.error, undefined)
  assert.equal(searchedDomain.emails[0]?.value, 'partnerships@example.com')

  console.log('hunter verification tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
