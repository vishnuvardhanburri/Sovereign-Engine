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

  if (/(^|[._-])u003[ce]/i.test(local) || /(^|[._-])u0026/i.test(local)) {
    return { valid: false, normalized, reason: 'escaped_html_email_artifact' }
  }

  // Block HTML-entity escape artifacts anywhere in the local part
  if (/u00[0-9a-f]{2}/i.test(local) || />|<|&amp;/.test(local)) {
    return { valid: false, normalized, reason: 'escaped_html_email_artifact' }
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
