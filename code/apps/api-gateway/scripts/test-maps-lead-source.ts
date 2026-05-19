import assert from 'node:assert/strict'
import {
  buildApifyDatasetsUrl,
  buildApifyDatasetItemsUrl,
  buildApifyTaskRunItemsUrl,
  fetchApifyTaskDatasetItems,
  fetchLatestApifyDatasetId,
  prepareMapsLeadContacts,
  resolveApifyMapsItems,
} from '../lib/maps-lead-source'

const items = [
  {
    title: 'Ignite Visibility',
    website: 'https://ignitevisibility.com',
    url: 'https://www.google.com/maps/place/Ignite+Visibility',
    emails: ['opportunity@ignitevisibility.com', 'support@ignitevisibility.com'],
    phone: '+1 619-555-0100',
    address: 'San Diego, CA',
    categoryName: 'Marketing agency',
  },
  {
    name: 'Bad Personal Lead',
    website: 'https://example-agency.com',
    email: 'founder@gmail.com',
  },
  {
    title: 'No Evidence Agency',
    emails: ['partnerships@no-evidence.example'],
  },
  {
    title: 'Duplicate Domain',
    website: 'https://ignitevisibility.com/contact',
    email: 'partners@ignitevisibility.com',
  },
  {
    title: 'Lemlist Partners',
    website: 'https://lemlist.com/partners',
    email: 'partnerships@lemlist.com',
    categories: ['Software company', 'Outbound sales'],
  },
]

const prepared = prepareMapsLeadContacts(items, {
  limit: 20,
  sourceName: 'apify_google_maps',
  sourceUrl: 'apify:dataset:test-dataset',
  dedupeByDomain: true,
  industry: 'agency',
  region: 'us',
})

assert.equal(prepared.summary.rows, 5)
assert.equal(prepared.summary.valid, 2)
assert.equal(prepared.summary.rejected, 4)
assert.equal(prepared.summary.evidenceBacked, 2)

assert.deepEqual(
  prepared.contacts.map((contact) => contact.email),
  ['opportunity@ignitevisibility.com', 'partnerships@lemlist.com']
)

const first = prepared.contacts[0]
assert.equal(first.company, 'Ignite Visibility')
assert.equal(first.companyDomain, 'ignitevisibility.com')
assert.equal(first.source, 'google_maps_apify')
assert.equal(first.customFields?.auto_approval_eligible, true)
assert.equal(first.customFields?.data_source, 'apify_google_maps')
assert.equal(first.customFields?.maps_import, true)
assert.equal(first.customFields?.public_evidence_url, 'https://ignitevisibility.com')
assert.equal(first.customFields?.maps_place_url, 'https://www.google.com/maps/place/Ignite+Visibility')
assert.match(String(first.customFields?.reason_to_contact), /agency/i)

assert.ok(prepared.rejected.some((lead) => lead.reason === 'blocked_mailbox_prefix'))
assert.ok(prepared.rejected.some((lead) => lead.reason === 'personal_email_domain'))
assert.ok(prepared.rejected.some((lead) => lead.reason === 'missing_public_evidence_url'))
assert.ok(prepared.rejected.some((lead) => lead.reason === 'duplicate_domain'))

assert.equal(
  buildApifyDatasetItemsUrl({
    datasetId: 'abc123',
    token: 'secret-token',
    limit: 25,
    offset: 10,
  }),
  'https://api.apify.com/v2/datasets/abc123/items?clean=true&format=json&limit=25&offset=10&token=secret-token'
)

assert.equal(
  buildApifyDatasetsUrl({
    token: 'secret-token',
    limit: 10,
  }),
  'https://api.apify.com/v2/datasets?limit=10&desc=1&unnamed=true&token=secret-token'
)

assert.equal(
  buildApifyTaskRunItemsUrl({
    taskId: 'google-maps-task',
    token: 'secret-token',
    limit: 25,
    timeoutSecs: 90,
  }),
  'https://api.apify.com/v2/actor-tasks/google-maps-task/run-sync-get-dataset-items?clean=true&format=json&limit=25&timeout=90&token=secret-token'
)

async function main() {
  const latestDatasetId = await fetchLatestApifyDatasetId({
    token: 'secret-token',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          data: {
            items: [
              {
                id: 'empty-dataset',
                itemCount: 0,
                modifiedAt: '2026-05-18T00:00:00.000Z',
              },
              {
                id: 'newest-non-empty',
                itemCount: 5,
                modifiedAt: '2026-05-18T01:00:00.000Z',
              },
              {
                id: 'older-non-empty',
                itemCount: 10,
                modifiedAt: '2026-05-17T01:00:00.000Z',
              },
            ],
          },
        }),
        { status: 200 }
      ),
  })

  assert.equal(latestDatasetId, 'newest-non-empty')

  const taskItems = await fetchApifyTaskDatasetItems({
    taskId: 'google-maps-task',
    token: 'secret-token',
    limit: 2,
    fetchImpl: async (url, init) => {
      assert.equal(
        String(url),
        'https://api.apify.com/v2/actor-tasks/google-maps-task/run-sync-get-dataset-items?clean=true&format=json&limit=2&timeout=120&token=secret-token'
      )
      assert.equal(init?.method, 'GET')
      return new Response(JSON.stringify([{ title: 'Evidence Agency' }]), { status: 200 })
    },
  })

  assert.deepEqual(taskItems, [{ title: 'Evidence Agency' }])

  const resolvedTaskRun = await resolveApifyMapsItems({
    token: 'secret-token',
    taskId: 'google-maps-task',
    limit: 2,
    fetchImpl: async (url) => {
      const text = String(url)
      if (text.startsWith('https://api.apify.com/v2/datasets?')) {
        return new Response(JSON.stringify({ data: { items: [] } }), { status: 200 })
      }
      if (text.startsWith('https://api.apify.com/v2/actor-tasks/')) {
        return new Response(JSON.stringify([{ title: 'Task Run Agency' }]), { status: 200 })
      }
      return new Response('unexpected url', { status: 500 })
    },
  })

  assert.equal(resolvedTaskRun.sourceType, 'apify_task')
  assert.equal(resolvedTaskRun.taskId, 'google-maps-task')
  assert.deepEqual(resolvedTaskRun.items, [{ title: 'Task Run Agency' }])

  await assert.rejects(
    () =>
      resolveApifyMapsItems({
        token: 'secret-token',
        fetchImpl: async () => new Response(JSON.stringify({ data: { items: [] } }), { status: 200 }),
      }),
    /APIFY_GOOGLE_MAPS_TASK_ID/
  )

  console.log('maps lead source tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
