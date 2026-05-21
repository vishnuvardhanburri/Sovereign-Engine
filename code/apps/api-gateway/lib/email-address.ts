export type EmailSyntaxResult = {
  valid: boolean
  normalized: string
  reason?: string
}

const ASCII_EMAIL_PATTERN =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/

export function validateBusinessEmailSyntax(email: string): EmailSyntaxResult {
  const normalized = String(email ?? '').trim().toLowerCase()

  if (!normalized) {
    return { valid: false, normalized, reason: 'empty_email' }
  }

  if (normalized.length > 254) {
    return { valid: false, normalized, reason: 'email_too_long' }
  }

  if (!/^[\x21-\x7E]+$/.test(normalized)) {
    return { valid: false, normalized, reason: 'non_ascii_email' }
  }

  const parts = normalized.split('@')
  if (parts.length !== 2) {
    return { valid: false, normalized, reason: 'invalid_at_count' }
  }

  const [local, domain] = parts
  if (!local || !domain) {
    return { valid: false, normalized, reason: 'missing_local_or_domain' }
  }

  if (local.length > 64) {
    return { valid: false, normalized, reason: 'local_part_too_long' }
  }

  if (domain.length > 253) {
    return { valid: false, normalized, reason: 'domain_too_long' }
  }

  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    return { valid: false, normalized, reason: 'invalid_local_dots' }
  }

  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) {
    return { valid: false, normalized, reason: 'invalid_domain_dots' }
  }

  if (!ASCII_EMAIL_PATTERN.test(normalized)) {
    return { valid: false, normalized, reason: 'invalid_business_email_syntax' }
  }

  const labels = domain.split('.')
  if (labels.some((label) => label.length > 63)) {
    return { valid: false, normalized, reason: 'domain_label_too_long' }
  }

  return { valid: true, normalized }
}
