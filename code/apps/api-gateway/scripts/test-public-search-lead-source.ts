import assert from 'node:assert/strict'
import {
  isPublicSearchResultQualifiedForTarget,
  publicSearchLeadsToContacts,
  searchPublicSearchLeads,
} from '../lib/public-search-lead-source'

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

  assert.equal(
    isPublicSearchResultQualifiedForTarget(
      {
        title: 'Outbound for Nintendo Switch',
        link: 'https://nintendo.com/',
        displayed_link: 'nintendo.com',
        snippet: 'Buy Outbound and shop other great Nintendo products online at the official Nintendo Store.',
      },
      'agency'
    ),
    false
  )

  assert.equal(
    isPublicSearchResultQualifiedForTarget(
      {
        title: 'Outbound Wiki',
        link: 'https://outbound.fandom.com/',
        displayed_link: 'outbound.fandom.com',
        snippet: 'Template:Infobox Outbound is a cozy open-world survival and crafting game.',
      },
      'agency'
    ),
    false
  )

  assert.equal(
    isPublicSearchResultQualifiedForTarget(
      {
        title: 'Acme Demand Generation Agency',
        link: 'https://exampleagency.com/',
        displayed_link: 'exampleagency.com',
        snippet: 'B2B demand generation agency helping SaaS teams with outbound sales and RevOps.',
      },
      'agency'
    ),
    true
  )

  console.log('public search lead source tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
