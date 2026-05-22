import assert from 'node:assert/strict'
import test from 'node:test'
import { recipientApprovalBlockers, recipientSyntaxBlockers } from './recipient-guardrails'

test('blocks HTML escape artifact recipients before send', () => {
  const blockers = recipientSyntaxBlockers('u003esupport@render.com')
  assert.ok(blockers.includes('escaped_html_email_artifact'))

  const approvalBlockers = recipientApprovalBlockers({
    email: 'u003esupport@render.com',
    status: 'active',
    verification_status: 'valid',
    custom_fields: { email_evidence: 'provider_validated' },
  })
  assert.ok(approvalBlockers.includes('invalid_email'))
})

test('allows normal business recipients', () => {
  assert.deepEqual(recipientSyntaxBlockers('success@atomicsocial.com'), [])
})
