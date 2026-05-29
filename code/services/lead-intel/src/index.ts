export type LeadIntelInput = {
  company_name?: string | null
  domain?: string | null
  role?: string | null
  email: string
}

export type SignalFlags = {
  hiring_sdrs: boolean
  mentions_outbound: boolean
  agency_keyword: boolean
  /** Signals pointing at SaaS / AI / security / devtools buyers (→ £25,000 internal offer) */
  saas_or_tech_keyword: boolean
}

export type LeadIntelOutput = {
  normalized_email: string
  company_description: string
  signal_flags: SignalFlags
  priority_score: number // 0..1
  allow_send: boolean
  reasons: string[]
  /**
   * Offer type routing hint:
   *   'agency'  → £100,000 white-label commercial offer
   *   'direct'  → £25,000 internal enterprise offer
   */
  offer_type_hint: 'agency' | 'direct'
}

const ROLE_PREFIXES = [
  'info',
  'hello',
  'support',
  'sales',
  'admin',
  'billing',
  'careers',
  'jobs',
  'hr',
  'team',
  'contact',
  'partners',
  'press',
  'security',
  'noreply',
  'no-reply',
]

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n))
}

export function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase()
}

export function isRoleEmail(email: string): boolean {
  const local = normalizeEmail(email).split('@')[0] ?? ''
  return ROLE_PREFIXES.some((p) => local === p || local.startsWith(`${p}.`) || local.startsWith(`${p}+`))
}

export function buildCompanyDescription(input: LeadIntelInput): string {
  const name = String(input.company_name ?? '').trim()
  const dom = String(input.domain ?? '').trim()
  if (name && dom) return `${name} (${dom})`
  if (name) return name
  if (dom) return dom
  return 'your company'
}

export function inferSignals(input: LeadIntelInput): SignalFlags {
  const hay = `${input.company_name ?? ''} ${input.domain ?? ''} ${input.role ?? ''}`.toLowerCase()
  const hiring_sdrs = hay.includes('sdr') || hay.includes('sales development') || hay.includes('hiring')
  const mentions_outbound = hay.includes('outbound') || hay.includes('cold email') || hay.includes('cold outreach') || hay.includes('deliverability')
  const agency_keyword =
    hay.includes('agency') ||
    hay.includes('studio') ||
    hay.includes('marketing') ||
    hay.includes('partner') ||
    hay.includes('reseller') ||
    hay.includes('white label') ||
    hay.includes('whitelabel')
  const saas_or_tech_keyword =
    hay.includes('saas') ||
    hay.includes('software') ||
    hay.includes('platform') ||
    hay.includes('ai ') ||
    hay.includes('automation') ||
    hay.includes('security') ||
    hay.includes('devtools') ||
    hay.includes('developer') ||
    hay.includes('api') ||
    hay.includes('revops') ||
    hay.includes('crm') ||
    hay.includes('infrastructure')
  return { hiring_sdrs, mentions_outbound, agency_keyword, saas_or_tech_keyword }
}

export function scoreLead(input: LeadIntelInput, flags: SignalFlags): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let score = 0.4

  if (flags.mentions_outbound) {
    score += 0.25
    reasons.push('signal:mentions_outbound')
  }
  if (flags.hiring_sdrs) {
    score += 0.15
    reasons.push('signal:hiring_sdrs')
  }
  if (flags.agency_keyword) {
    score += 0.1
    reasons.push('signal:agency_keyword')
  }
  if (flags.saas_or_tech_keyword) {
    score += 0.08
    reasons.push('signal:saas_or_tech_keyword')
  }

  const role = String(input.role ?? '').toLowerCase()
  if (role.includes('founder') || role.includes('ceo') || role.includes('head') || role.includes('growth')) {
    score += 0.1
    reasons.push('role:decision_maker')
  }

  if (!input.company_name && !input.domain) {
    score -= 0.1
    reasons.push('missing:company_context')
  }

  return { score: clamp01(score), reasons }
}

/** Determine which Sovereign Stack offer to lead with for this prospect. */
export function inferOfferType(flags: SignalFlags): 'agency' | 'direct' {
  // Agencies, studios, marketing firms, and resellers -> £100,000 white-label commercial offer
  if (flags.agency_keyword) return 'agency'
  // Pure SaaS / tech / AI buyers -> £25,000 internal enterprise license
  return 'direct'
}

export function enrichLead(input: LeadIntelInput): LeadIntelOutput {
  const normalized_email = normalizeEmail(input.email)
  const reasons: string[] = []

  if (isRoleEmail(normalized_email)) {
    const signal_flags = inferSignals(input)
    return {
      normalized_email,
      company_description: buildCompanyDescription(input),
      signal_flags,
      priority_score: 0,
      allow_send: false,
      reasons: ['blocked:role_email'],
      offer_type_hint: inferOfferType(signal_flags),
    }
  }

  const signal_flags = inferSignals(input)
  const scored = scoreLead(input, signal_flags)
  reasons.push(...scored.reasons)

  const priority_score = scored.score
  const allow_send = priority_score >= 0.6
  if (!allow_send) reasons.push('blocked:priority_score_lt_0_6')

  const offer_type_hint = inferOfferType(signal_flags)

  return {
    normalized_email,
    company_description: buildCompanyDescription(input),
    signal_flags,
    priority_score,
    allow_send,
    reasons,
    offer_type_hint,
  }
}
