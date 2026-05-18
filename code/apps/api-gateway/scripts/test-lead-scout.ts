import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import {
  scoutOpenLeads,
  verifyOpenLeadEvidence,
  verifyOpenLeadEvidenceTimeboxed,
  type OpenLead,
} from '@/lib/lead-scout'

const originalFetch = globalThis.fetch

function lead(overrides: Partial<OpenLead> = {}): OpenLead {
  return {
    email: 'partnerships@example.com',
    company: 'Example',
    companyDomain: 'example.com',
    title: 'partnerships team',
    source: 'test',
    fitScore: 90,
    reason: 'Relevant test company.',
    confidence: 'high',
    ...overrides,
  }
}

async function main() {
  const automotive = scoutOpenLeads({
    industry: 'automotive',
    persona: 'partnerships',
    region: 'us',
    limit: 3,
  })

  assert.equal(automotive.industry, 'automotive')
  assert.equal(automotive.leads.length, 3)
  assert.ok(automotive.leads.every((item) => item.companyDomain))
  assert.ok(
    automotive.leads.some((item) =>
      /dealer|automotive|vehicle|repair|fleet/i.test(item.reason)
    )
  )

  globalThis.fetch = async () =>
    new Response('<html>Contact partnerships@example.com for partners.</html>', {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })

  const [verified] = await verifyOpenLeadEvidence([lead()], {
    deadlineMs: 500,
    maxPagesPerLead: 2,
    requestTimeoutMs: 100,
  })

  assert.equal(verified.autoApprovalEligible, true)
  assert.equal(verified.emailEvidence, 'public_page_match')
  assert.equal(verified.publicEvidenceUrl, 'https://example.com/')

  globalThis.fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal
      const timer = setTimeout(() => reject(new Error('expected abort')), 5_000)
      if (signal?.aborted) {
        clearTimeout(timer)
        reject(new Error('aborted'))
        return
      }
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          reject(new Error('aborted'))
        },
        { once: true }
      )
    }) as Promise<Response>

  const startedAt = performance.now()
  const [timedOut] = await verifyOpenLeadEvidence([lead({ email: 'hello@slow.example' })], {
    deadlineMs: 250,
    maxPagesPerLead: 4,
    requestTimeoutMs: 100,
  })
  const elapsedMs = performance.now() - startedAt

  assert.equal(timedOut.autoApprovalEligible, false)
  assert.equal(timedOut.emailEvidence, 'synthetic_role_pattern')
  assert.ok(elapsedMs < 1_000, `expected timeboxed verification, got ${elapsedMs}ms`)

  const outerStartedAt = performance.now()
  const [outerTimedOut] = await verifyOpenLeadEvidenceTimeboxed([lead({ email: 'ops@stuck.example' })], {
    deadlineMs: 150,
    maxPagesPerLead: 8,
    requestTimeoutMs: 3_000,
  })
  const outerElapsedMs = performance.now() - outerStartedAt

  assert.equal(outerTimedOut.autoApprovalEligible, false)
  assert.equal(outerTimedOut.emailEvidence, 'synthetic_role_pattern')
  assert.ok(outerElapsedMs < 700, `expected route-level timebox, got ${outerElapsedMs}ms`)
}

main()
  .then(() => {
    console.log('Lead Scout evidence verification tests passed')
  })
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    globalThis.fetch = originalFetch
  })
