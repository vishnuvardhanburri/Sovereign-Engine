export type PersonalizeInput = {
  company: string
  role?: string | null
  signal_flags?: {
    hiring_sdrs?: boolean
    mentions_outbound?: boolean
    agency_keyword?: boolean
  }
  company_description?: string | null
}

export type GeneratedEmail = {
  subject: string
  body: string // <=120 words target
}

function words(s: string) {
  return String(s || '').trim().split(/\s+/).filter(Boolean).length
}

export function generateEmail(input: PersonalizeInput): GeneratedEmail {
  const company = String(input.company || 'your company').trim()
  const desc = String(input.company_description || '').trim()

  const companyLine = desc
    ? `Noticed ${company} ${desc.includes(company) ? '—' : `(${desc})`} is doing outbound.`
    : `Saw you’re doing outbound at ${company}.`

  const body = [
    companyLine,
    `Teams at your stage often see reply drops when volume increases.`,
    ``,
    `We run a backend system that controls sending (not blasting), which improves replies and protects domains.`,
    ``,
    `Open to a quick 10–15 min chat?`,
  ].join('\n')

  const subject = `Quick question about ${company}`

  // Keep it tight if we went long.
  if (words(body) > 120) {
    return {
      subject,
      body: [
        `Saw you’re doing outbound at ${company}.`,
        `Teams often see reply drops when volume increases.`,
        ``,
        `We control sending (not blasting) to protect domains and improve replies.`,
        ``,
        `Open to a quick 10–15 min chat?`,
      ].join('\n'),
    }
  }

  return { subject, body }
}

