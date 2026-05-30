import assert from 'node:assert/strict'
import { publicSearchLeadsToContacts, searchPublicSearchLeads } from '../lib/public-search-lead-source'

async function main() {
  const result = await searchPublicSearchLeads({
    provider: 'duckduckgo_html',
    industry: 'agency',
    persona: 'founder',
    region: 'United States',
    limit: 5,
    timeoutMs: 8_000,
    queries: ['outbound agency contact B2B United States'],
  })

  assert.ok(result.scannedResults >= 0)

  const syntheticLead = {
    email: 'hello@exampleagency.com',
    company: 'Example Agency',
    companyDomain: 'exampleagency.com',
    title: 'founder team',
    source: 'public_search',
    fitScore: 66,
    reason: 'Public search result matched agency target profile.',
    confidence: 'medium' as const,
    emailEvidence: 'business_domain_role_pattern' as const,
    publicEvidenceUrl: 'https://exampleagency.com/',
    autoApprovalEligible: true,
  }

  const [contact] = publicSearchLeadsToContacts([syntheticLead])

  assert.equal(contact.email, 'hello@exampleagency.com')
  assert.equal(contact.companyDomain, 'exampleagency.com')
  assert.equal(contact.customFields?.auto_approval_eligible, true)
  assert.equal(contact.customFields?.email_evidence, 'business_domain_role_pattern')
  assert.equal(contact.customFields?.public_search, true)

  console.log('public search lead source tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
