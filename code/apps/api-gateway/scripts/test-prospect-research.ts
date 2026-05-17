import assert from 'node:assert/strict'
import {
  enrichProspectWithPublicEmailEvidence,
  pageContainsExactEmail,
  scoreProspectForResearchApproval,
} from '../lib/prospect-research'

async function main() {
assert.equal(
  pageContainsExactEmail(
    '<a href="mailto:partnerships@realagency.com">Partner with us</a>',
    'partnerships@realagency.com'
  ),
  true
)
assert.equal(
  pageContainsExactEmail('Email partnerships [at] realagency [dot] com', 'partnerships@realagency.com'),
  true
)
assert.equal(
  pageContainsExactEmail('Contact sales@realagency.com for growth', 'partnerships@realagency.com'),
  false
)

const safe = scoreProspectForResearchApproval({
  id: 1,
  email: 'opportunity@ignitevisibility.com',
  email_domain: 'ignitevisibility.com',
  company: 'Ignite Visibility',
  company_domain: 'ignitevisibility.com',
  source: 'google_sheet_import',
  status: 'active',
  verification_status: 'pending',
  custom_fields: {
    sheet_import: true,
    auto_approval_eligible: true,
    public_evidence_url: 'https://ignitevisibility.com/contact/',
    reason_to_contact: 'Agency with public growth and demand generation signals.',
  },
})

assert.equal(safe.approved, true)
assert.equal(safe.blockers.length, 0)
assert.ok(safe.score >= 72)
assert.ok(safe.reasons.includes('safe_business_inbox'))

const personal = scoreProspectForResearchApproval({
  id: 2,
  email: 'founder@gmail.com',
  email_domain: 'gmail.com',
  company: 'Founder',
  company_domain: 'example.com',
  source: 'google_sheet_import',
  status: 'active',
  verification_status: 'pending',
  custom_fields: {
    sheet_import: true,
    auto_approval_eligible: true,
    public_evidence_url: 'https://example.com/contact',
  },
})

assert.equal(personal.approved, false)
assert.ok(personal.blockers.includes('personal_email_domain'))

const unsupportedInbox = scoreProspectForResearchApproval({
  id: 3,
  email: 'support@realagency.com',
  email_domain: 'realagency.com',
  company: 'Real Agency',
  company_domain: 'realagency.com',
  source: 'google_sheet_import',
  status: 'active',
  verification_status: 'pending',
  custom_fields: {
    sheet_import: true,
    auto_approval_eligible: true,
    public_evidence_url: 'https://realagency.com/contact',
  },
})

assert.equal(unsupportedInbox.approved, false)
assert.ok(unsupportedInbox.blockers.includes('blocked_mailbox_prefix'))

const mismatch = scoreProspectForResearchApproval({
  id: 4,
  email: 'sales@realagency.com',
  email_domain: 'realagency.com',
  company: 'Different Agency',
  company_domain: 'differentagency.com',
  source: 'google_sheet_import',
  status: 'active',
  verification_status: 'pending',
  custom_fields: {
    sheet_import: true,
    auto_approval_eligible: true,
    public_evidence_url: 'https://differentagency.com/contact',
  },
})

assert.equal(mismatch.approved, false)
assert.ok(mismatch.blockers.includes('email_company_domain_mismatch'))

const personLike = scoreProspectForResearchApproval({
  id: 5,
  email: 'alex.lee@realagency.com',
  email_domain: 'realagency.com',
  company: 'Real Agency',
  company_domain: 'realagency.com',
  source: 'google_sheet_import',
  status: 'active',
  verification_status: 'pending',
  custom_fields: {
    sheet_import: true,
    auto_approval_eligible: true,
    public_evidence_url: 'https://realagency.com/team',
  },
})

assert.equal(personLike.approved, false)
assert.ok(personLike.blockers.includes('person_like_email_requires_manual_review'))

const unverifiedGenericInbox = scoreProspectForResearchApproval({
  id: 6,
  email: 'hello@realagency.com',
  email_domain: 'realagency.com',
  company: 'Real Agency',
  company_domain: 'realagency.com',
  source: 'google_sheet_import',
  status: 'active',
  verification_status: 'pending',
  custom_fields: {
    sheet_import: true,
    auto_approval_eligible: true,
    public_evidence_url: 'https://realagency.com/contact',
    reason_to_contact: 'Agency with public growth and demand generation signals.',
  },
})

assert.equal(unverifiedGenericInbox.approved, false)
assert.ok(
  unverifiedGenericInbox.blockers.includes('generic_inbox_requires_email_validation')
)

const verifiedGenericInbox = scoreProspectForResearchApproval({
  id: 7,
  email: 'hello@realagency.com',
  email_domain: 'realagency.com',
  company: 'Real Agency',
  company_domain: 'realagency.com',
  source: 'google_sheet_import',
  status: 'active',
  verification_status: 'valid',
  custom_fields: {
    sheet_import: true,
    auto_approval_eligible: true,
    public_evidence_url: 'https://realagency.com/contact',
    reason_to_contact: 'Agency with public growth and demand generation signals.',
  },
})

assert.equal(verifiedGenericInbox.approved, true)

const guessedPartnershipsInbox = scoreProspectForResearchApproval({
  id: 8,
  email: 'partnerships@realagency.com',
  email_domain: 'realagency.com',
  company: 'Real Agency',
  company_domain: 'realagency.com',
  source: 'google_sheet_import',
  status: 'active',
  verification_status: 'pending',
  custom_fields: {
    sheet_import: true,
    auto_approval_eligible: true,
    public_evidence_url: 'https://realagency.com/about',
    reason_to_contact: 'Agency with public growth and demand generation signals.',
  },
})

assert.equal(guessedPartnershipsInbox.approved, false)
assert.ok(
  guessedPartnershipsInbox.blockers.includes(
    'risky_role_requires_exact_public_email_evidence'
  )
)

const publiclyVerifiedPartnershipsInbox = scoreProspectForResearchApproval({
  id: 9,
  email: 'partnerships@realagency.com',
  email_domain: 'realagency.com',
  company: 'Real Agency',
  company_domain: 'realagency.com',
  source: 'google_sheet_import',
  status: 'active',
  verification_status: 'pending',
  custom_fields: {
    sheet_import: true,
    auto_approval_eligible: true,
    email_evidence: 'public_page_email_match',
    public_evidence_url: 'https://realagency.com/partners',
    reason_to_contact: 'Agency with public growth and demand generation signals.',
  },
})

assert.equal(publiclyVerifiedPartnershipsInbox.approved, true)

const exactEvidenceResult = await enrichProspectWithPublicEmailEvidence(
  {
    id: 10,
    email: 'partnerships@realagency.com',
    email_domain: 'realagency.com',
    company: 'Real Agency',
    company_domain: 'realagency.com',
    source: 'google_sheet_import',
    status: 'active',
    verification_status: 'pending',
    custom_fields: {
      sheet_import: true,
      auto_approval_eligible: true,
      public_evidence_url: 'https://realagency.com/partners',
      reason_to_contact: 'Agency with public growth and demand generation signals.',
    },
  },
  {
    fetchPage: async () => ({
      ok: true,
      text: async () => '<a href="mailto:partnerships@realagency.com">Partnerships</a>',
    }),
    now: () => new Date('2026-05-18T00:00:00.000Z'),
  }
)

assert.equal(exactEvidenceResult.checked, true)
assert.equal(exactEvidenceResult.matched, true)
assert.equal(
  exactEvidenceResult.contact.custom_fields?.email_evidence,
  'public_page_email_match'
)

const exactEvidenceScore = scoreProspectForResearchApproval(
  exactEvidenceResult.contact
)
assert.equal(exactEvidenceScore.approved, true)

const missingExactEvidenceResult = await enrichProspectWithPublicEmailEvidence(
  {
    id: 11,
    email: 'partnerships@realagency.com',
    email_domain: 'realagency.com',
    company: 'Real Agency',
    company_domain: 'realagency.com',
    source: 'google_sheet_import',
    status: 'active',
    verification_status: 'pending',
    custom_fields: {
      sheet_import: true,
      auto_approval_eligible: true,
      public_evidence_url: 'https://realagency.com/partners',
      reason_to_contact: 'Agency with public growth and demand generation signals.',
    },
  },
  {
    fetchPage: async () => ({
      ok: true,
      text: async () => 'Partner with Real Agency.',
    }),
  }
)

assert.equal(missingExactEvidenceResult.checked, true)
assert.equal(missingExactEvidenceResult.matched, false)
assert.equal(
  missingExactEvidenceResult.contact.custom_fields?.email_evidence,
  undefined
)

console.log('prospect research tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
