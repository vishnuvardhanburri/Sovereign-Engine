import type { Contact } from '@/lib/db/types'

const TLD_TIMEZONES: Record<string, string> = {
  in: 'Asia/Kolkata',
  us: 'America/New_York',
  ca: 'America/Toronto',
  uk: 'Europe/London',
  gb: 'Europe/London',
  au: 'Australia/Sydney',
  de: 'Europe/Berlin',
  fr: 'Europe/Paris',
  es: 'Europe/Madrid',
  it: 'Europe/Rome',
  nl: 'Europe/Amsterdam',
  se: 'Europe/Stockholm',
  no: 'Europe/Oslo',
  br: 'America/Sao_Paulo',
  mx: 'America/Mexico_City',
  sg: 'Asia/Singapore',
  ae: 'Asia/Dubai',
}

export function inferTimezoneFromEmail(email: string): string | null {
  const domain = email.split('@')[1]?.toLowerCase() ?? ''
  const tld = domain.split('.').pop() ?? ''
  return TLD_TIMEZONES[tld] ?? null
}

export function getSendWindowNext(
  timezone: string,
  now = new Date(),
  windowStartHour = 9,
  windowEndHour = 17
): Date | null {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]))
    const year = Number(parts.year)
    const month = Number(parts.month)
    const day = Number(parts.day)
    const hour = Number(parts.hour)

    // Within window: allow now.
    if (hour >= windowStartHour && hour < windowEndHour) return null

    const targetDayOffset = hour < windowStartHour ? 0 : 1
    const target = new Date(Date.UTC(year, month - 1, day + targetDayOffset, windowStartHour, 0, 0))
    return new Date(target.getTime())
  } catch {
    return null
  }
}

export function ensureContactTimezone(contact: Contact): string | null {
  return contact.timezone ?? inferTimezoneFromEmail(contact.email)
}

