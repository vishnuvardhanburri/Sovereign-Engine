const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeEmail(input: string): { ok: true; email: string; local: string; domain: string } | { ok: false; reason: string } {
  const raw = String(input ?? '').trim()
  if (!raw) return { ok: false, reason: 'empty' }
  if (raw.includes(' ')) return { ok: false, reason: 'spaces' }
  const lower = raw.toLowerCase()
  if (!EMAIL_RE.test(lower)) return { ok: false, reason: 'invalid_syntax' }
  const [local, domain] = lower.split('@')
  if (!local || !domain) return { ok: false, reason: 'invalid_syntax' }
  if (domain.includes('..') || domain.startsWith('.') || domain.endsWith('.')) return { ok: false, reason: 'invalid_domain' }
  return { ok: true, email: lower, local, domain }
}

export function isRoleAddress(local: string): boolean {
  const role = new Set([
    'admin','administrator','support','sales','billing','info','contact','help','security','abuse','noc','postmaster','hostmaster','team','hello'
  ])
  return role.has(local)
}

export function isDisposableDomain(domain: string): boolean {
  // Minimal guard. For production you’d swap to a maintained list / dataset.
  const disposable = new Set(['mailinator.com','guerrillamail.com','10minutemail.com'])
  return disposable.has(domain)
}

