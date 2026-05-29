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
  SOVEREIGN_STACK_DIRECT_SEQUENCE_STEPS,
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

assert(inferSovereignOfferType(directLead) === 'direct', 'direct lead should use £25,000 copy')
assert(inferSovereignOfferType(agencyLead) === 'agency', 'agency lead should use master-license copy')
assert(sovereignDealValueUsd(directLead) === 25000, 'direct lead should be valued at £25,000')
assert(sovereignDealValueUsd(agencyLead) === 100000, 'agency lead should be valued at £100,000')
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
  SOVEREIGN_STACK_DIRECT_SEQUENCE_STEPS.map((step) => step.day).join(',') === '0,3,5,8',
  'default sequence should use Day 1, Day 3, Day 5, Day 8 cadence'
)
assert(
  SOVEREIGN_STACK_DIRECT_SEQUENCE_STEPS.at(-1)?.subject === 'closing the loop',
  'final sequence step should be the soft breakup'
)
assert(
  sovereignSubjectForLead(directLead).includes('deliverability'),
  'direct subject should lead with deliverability pain'
)
assert(
  sovereignSubjectForLead(agencyLead).includes('white-label outbound'),
  'agency subject should use premium white-label copy'
)

const directBody = renderSovereignTemplate(
  sovereignBodyForLead(directLead),
  directLead,
  'Xavira Tech Labs, India'
)
assert(directBody.includes('Xavira Control Stack'), 'direct body should mention Xavira Control Stack')
assert(directBody.includes(SOVEREIGN_BOOKING_URL), 'direct body should include booking link')
assert(
  directBody.includes('Gmail/Outlook throttling'),
  'direct body should name concrete deliverability pain'
)
assert(
  directBody.includes('short outbound infrastructure review'),
  'direct body should offer a low-friction infrastructure review'
)
assert(directBody.includes('Example SaaS'), 'direct body should render company')
assert(!directBody.includes('{{'), 'direct body should render all placeholders')
assert(
  buildSovereignPainLine(directLead).includes('Example SaaS'),
  'pain line should be company-specific'
)
assert(!/Quick check/i.test(sovereignSubjectForLead(directLead)), 'subjects should avoid generic quick-check wording')

const directHtml = renderSovereignHtmlEmail(directBody)
assert(directHtml.includes(`href="${SOVEREIGN_BOOKING_URL}"`), 'html should include booking button URL')
assert(directHtml.includes('Book 20-min audit'), 'html should render a small CTA button')

const genericInboxBody = renderSovereignTemplate(
  sovereignBodyForLead({ first_name: 'hello', company: 'Inbox Co' }),
  { first_name: 'hello', company: 'Inbox Co' },
  'Xavira Tech Labs, India'
)
assert(genericInboxBody.startsWith('Hi there,'), 'generic inboxes should not render as names')
assert(!genericInboxBody.includes('Hi hello,'), 'generic inbox local parts should be suppressed')

const agencyBody = renderSovereignTemplate(
  sovereignBodyForLead(agencyLead),
  agencyLead,
  'Xavira Tech Labs, India'
)
assert(agencyBody.includes('£100,000'), 'agency body should mention final commercial license price')
assert(agencyBody.includes('reseller rights'), 'agency body should mention commercial rights')
assert(agencyBody.includes('Xavira Control Stack'), 'agency body should mention Xavira Control Stack')
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
  assert(
    rendered.text.includes('short outbound infrastructure review'),
    'built copy should use the new pain-led review ask'
  )

  console.log('outbound copy tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
