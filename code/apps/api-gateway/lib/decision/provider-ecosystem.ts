export type MailboxProvider = 'gmail' | 'outlook' | 'yahoo' | 'icloud' | 'other'

const OUTLOOK_DOMAINS = new Set([
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'office365.com',
  'onmicrosoft.com',
])

const YAHOO_DOMAINS = new Set(['yahoo.com', 'ymail.com', 'rocketmail.com'])
const ICLOUD_DOMAINS = new Set(['icloud.com', 'me.com', 'mac.com'])

export function detectMailboxProvider(emailOrDomain: string): MailboxProvider {
  const domain = emailOrDomain.includes('@') ? emailOrDomain.split('@').pop() ?? '' : emailOrDomain
  const normalized = domain.trim().toLowerCase()
  if (!normalized) return 'other'
  if (normalized === 'gmail.com' || normalized === 'googlemail.com') return 'gmail'
  if (OUTLOOK_DOMAINS.has(normalized) || normalized.endsWith('.protection.outlook.com')) return 'outlook'
  if (YAHOO_DOMAINS.has(normalized)) return 'yahoo'
  if (ICLOUD_DOMAINS.has(normalized)) return 'icloud'
  return 'other'
}

export function providerRiskFloor(provider: MailboxProvider): number {
  switch (provider) {
    case 'gmail':
    case 'outlook':
      return 28
    case 'yahoo':
    case 'icloud':
      return 34
    default:
      return 18
  }
}
