import {
  inferSovereignOfferType,
  balanceSovereignOfferMix,
  buildLeadResearchContext,
  buildSovereignCopyForLead,
  buildSovereignPainLine,
  rankSovereignLeads,
  renderSovereignHtmlEmail,
  renderSovereignTemplate,
  SOVEREIGN_BOOKING_URL,
  sovereignDealValueUsd,
  sovereignBodyForLead,
  sovereignSubjectForLead,
} from '@/lib/outbound-copy'

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message)
  }
}

const directLead = {
  first_name: 'Ava',
  company: 'Example SaaS',
  companyDomain: 'example-saas.com',
  title: 'RevOps',
  reason_to_contact: 'active outbound campaigns',
}

const agencyLead = {
  first_name: 'Maya',
  company: 'Example Agency',
  companyDomain: 'example-agency.com',
  title: 'partnerships team',
  reason_to_contact: 'agency outreach because it shows public signals around demand generation',
}

assert(inferSovereignOfferType(directLead) === 'direct', 'direct lead should use $25k copy')
assert(inferSovereignOfferType(agencyLead) === 'agency', 'agency lead should use master-license copy')
assert(sovereignDealValueUsd(directLead) === 25000, 'direct lead should be valued at $25k')
assert(sovereignDealValueUsd(agencyLead) === 100000, 'agency lead should be valued at $100k')
assert(
  rankSovereignLeads([
    { ...directLead, customFields: { fit_score: 100 } },
    { ...agencyLead, customFields: { fit_score: 70 } },
  ])[0]?.company === agencyLead.company,
  'agency master-license leads should outrank direct leads even with lower fit score'
)
const balanced = balanceSovereignOfferMix(
  [
    { ...agencyLead, company: 'Agency A', customFields: { fit_score: 99 } },
    { ...agencyLead, company: 'Agency B', customFields: { fit_score: 98 } },
    { ...directLead, company: 'Direct A', customFields: { fit_score: 97 } },
    { ...directLead, company: 'Direct B', customFields: { fit_score: 96 } },
  ],
  4
)
assert(
  balanced.filter((lead) => inferSovereignOfferType(lead) === 'agency').length === 2,
  'balanced queue should reserve about half for agency offers'
)
assert(
  balanced.filter((lead) => inferSovereignOfferType(lead) === 'direct').length === 2,
  'balanced queue should reserve about half for direct offers'
)
assert(
  sovereignSubjectForLead(directLead).includes('outbound deliverability'),
  'direct subject should use requested copy'
)
assert(
  sovereignSubjectForLead(agencyLead).includes('White-label outbound'),
  'agency subject should use requested copy'
)

const directBody = renderSovereignTemplate(
  sovereignBodyForLead(directLead),
  directLead,
  'Xavira Tech Labs, India'
)
assert(directBody.includes('Sovereign Stack'), 'direct body should mention Sovereign Stack')
assert(directBody.includes(SOVEREIGN_BOOKING_URL), 'direct body should include booking link')
assert(
  directBody.includes('$25,000 one-time license'),
  'direct body should mention the $25,000 license'
)
assert(
  directBody.includes('expected win') || directBody.includes('Expected win'),
  'direct body should explain the buyer outcome'
)
assert(directBody.includes('Example SaaS'), 'direct body should render company')
assert(!directBody.includes('{{'), 'direct body should render all placeholders')
assert(
  buildSovereignPainLine(directLead).includes('Example SaaS'),
  'pain line should be company-specific'
)

const directHtml = renderSovereignHtmlEmail(directBody)
assert(directHtml.includes(`href="${SOVEREIGN_BOOKING_URL}"`), 'html should include booking button URL')
assert(directHtml.includes('Book 20-min audit'), 'html should render a small CTA button')

const genericInboxBody = renderSovereignTemplate(
  sovereignBodyForLead({ first_name: 'hello', company: 'Inbox Co' }),
  { first_name: 'hello', company: 'Inbox Co' },
  'Xavira Tech Labs, India'
)
assert(genericInboxBody.startsWith('Hey there,'), 'generic inboxes should not render as names')
assert(!genericInboxBody.includes('Hey hello,'), 'generic inbox local parts should be suppressed')

const agencyBody = renderSovereignTemplate(
  sovereignBodyForLead(agencyLead),
  agencyLead,
  'Xavira Tech Labs, India'
)
assert(agencyBody.includes('$100k one-time'), 'agency body should mention $100k master license')
assert(agencyBody.includes('white-labeled deployments'), 'agency body should mention white-label value')
assert(agencyBody.includes(SOVEREIGN_BOOKING_URL), 'agency body should include booking link')
assert(!agencyBody.includes('{{'), 'agency body should render all placeholders')

const researchContext = buildLeadResearchContext({
  ...agencyLead,
  customFields: {
    linkedin_url: 'https://www.linkedin.com/company/example-agency',
    linkedin_post_url: 'https://www.linkedin.com/feed/update/example',
    social_signal: 'recent post about outbound scaling',
    competitor_signal: 'category is adopting AI governance',
  },
})
assert(
  researchContext.linkedinPostUrl?.includes('linkedin.com'),
  'research context should preserve LinkedIn post evidence'
)
assert(
  researchContext.competitorSignal === 'category is adopting AI governance',
  'research context should carry competitor/category signal only from evidence'
)

async function main() {
  const rendered = await buildSovereignCopyForLead(directLead, {
    physicalAddress: 'Xavira Tech Labs, India',
    useOpenRouter: false,
  })
  assert(rendered.html.includes('Book 20-min audit'), 'built copy should include HTML CTA')
  assert(rendered.text.includes('Worth a quick audit'), 'built copy should use the new pain-led ask')

  console.log('outbound copy tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
