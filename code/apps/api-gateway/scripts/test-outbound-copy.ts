import {
  inferSovereignOfferType,
  rankSovereignLeads,
  renderSovereignTemplate,
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
assert(
  directBody.includes('$25,000 one-time license (Sovereign Engine + Sovereign Shield)'),
  'direct body should mention the $25,000 Engine + Shield license'
)
assert(directBody.includes('Example SaaS'), 'direct body should render company')
assert(!directBody.includes('{{'), 'direct body should render all placeholders')

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
assert(!agencyBody.includes('{{'), 'agency body should render all placeholders')

console.log('outbound copy tests passed')
