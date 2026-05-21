import type { SovereignOfferType, SovereignCopyLead } from './outbound-copy'

export const SOVEREIGN_SALES_BRAIN_VERSION = '2026-05-approval-inventory-v1'

export const SOVEREIGN_SALES_BRAIN_SOURCES = [
  'MILLION-DOLLAR SALES FRAMEWORK',
  'COLD EMAIL DOMINATION FRAMEWORK',
  'COMPETITIVE ANALYSIS',
  'Funnel Creation & The Content Magnet System',
  'High-Ticket Ads Playbook',
  'Inbound vs Outbound',
  'My Sales script',
  'N8N SALES AUTOMATION PLAYBOOK',
  'The Invisible Loopholes That Decide Who Wins in Any Field',
  'THE REAL REASON YOU ARE NOT CLOSING',
  'VALUE STACKING FOR $10K-$200K OFFERS',
]

const CORE_RULES = [
  'Lead with pain before product: domain burn, inbox placement drops, AI PII leakage, prompt injection, compliance exposure.',
  'Make one clear offer: Sovereign Stack combines Sovereign Engine and Sovereign Shield in one license.',
  'Keep the ask low-friction: offer a 15-20 minute risk audit and live dashboard walkthrough.',
  'Use proof language over hype: self-hosted, audit-ready, works above existing outbound tools, no fake customer claims.',
  'Write like a helpful human: short sentences, specific business pain, no buzzword pileups, no AI-sounding filler.',
  'Preserve deal value: direct offer is $25,000 one-time; agency master offer is $100,000 one-time.',
  'Use payment-plan language only as a conversion aid, not as the headline.',
  'Personalize from verified public evidence only; never invent a founder, campaign, revenue number, or private fact.',
  'Use social, LinkedIn, or competitor context only when it is present in the lead research payload; otherwise skip it.',
  'Never claim competitors are customers unless the lead record contains explicit competitor evidence.',
  'Every email must include a clear booking CTA and a polite opt-out line.',
]

const DIRECT_RULES = [
  'Direct offer: $25,000 one-time Sovereign Stack license.',
  'Frame the ROI as protecting outbound revenue and reducing AI/compliance risk.',
  'Mention Sovereign Engine as adaptive deliverability OS and Sovereign Shield as private AI security gateway.',
  'Best CTA: 20-minute audit + demo next week.',
]

const AGENCY_RULES = [
  'Agency offer: $100,000 Agency Master License.',
  'Frame it as a white-label infrastructure product agencies can resell to clients.',
  'Mention unlimited white-labeled deployments, client resale potential, and Xavira core updates.',
  'Best CTA: white-label demo and offer-fit review.',
]

const FOLLOW_UP_RULES = [
  'Sequence steps: Day 1 audit ask, Day 4 risk follow-up, Day 7 payment-plan option, Day 11 soft bump, Day 16 final note.',
  'Stop follow-ups on replies, bounces, unsubscribes, invalid validation, or suppression match.',
  'Follow-ups should add clarity, not pressure; never guilt or threaten.',
]

export function buildSalesBrainContext(
  lead: SovereignCopyLead,
  offerType: SovereignOfferType
): string {
  const custom = lead.customFields ?? {}
  const company = String(lead.company || lead.companyDomain || 'the company')
  const region = String(custom.region || custom.country || custom.location || 'global')
  const evidence = String(
    custom.research_evidence_url ||
      custom.public_evidence_url ||
      custom.sheet_source_url ||
      lead.source ||
      'operator-owned lead source'
  )
  const socialContext = [
    custom.linkedin_url ? `LinkedIn: ${custom.linkedin_url}` : '',
    custom.linkedin_post_url ? `LinkedIn post: ${custom.linkedin_post_url}` : '',
    custom.social_signal ? `Social signal: ${custom.social_signal}` : '',
    custom.competitor_signal ? `Competitor/category signal: ${custom.competitor_signal}` : '',
    custom.research_summary ? `Research summary: ${custom.research_summary}` : '',
  ].filter(Boolean)
  const rules = offerType === 'agency' ? AGENCY_RULES : DIRECT_RULES

  return [
    `Sovereign Sales Brain ${SOVEREIGN_SALES_BRAIN_VERSION}`,
    `Lead: ${company}`,
    `Region/context: ${region}`,
    `Evidence source: ${evidence}`,
    socialContext.length > 0 ? 'Lead research context:' : '',
    ...socialContext.map((item) => `- ${item}`),
    'Core rules:',
    ...CORE_RULES.map((rule) => `- ${rule}`),
    'Offer rules:',
    ...rules.map((rule) => `- ${rule}`),
    'Follow-up rules:',
    ...FOLLOW_UP_RULES.map((rule) => `- ${rule}`),
  ].join('\n')
}

export function salesBrainBulletPoints(offerType: SovereignOfferType): string[] {
  return [
    'Pain-first opener tied to outbound revenue risk',
    offerType === 'agency'
      ? '$100k white-label master-license value stack'
      : '$25k direct Sovereign Stack value stack',
    'Low-friction audit/demo CTA with booking link',
    'Evidence-backed personalization only',
    'Compliance-safe opt-out and follow-up stop conditions',
  ]
}
