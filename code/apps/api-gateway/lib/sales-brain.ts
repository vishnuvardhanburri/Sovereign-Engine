import type { SovereignOfferType, SovereignCopyLead } from './outbound-copy'

export const SOVEREIGN_SALES_BRAIN_VERSION = '2026-05-xavira-control-stack-v2'

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
  'Position Xavira Tech Labs as an enterprise infrastructure vendor, not a cold email tool or agency.',
  'Lead with the buyer question: why buy this, what risk or profit does it affect, and why now.',
  'Lead with pain before product: domain burn, inbox placement drops, AI PII leakage, prompt injection, compliance exposure, stalled follow-ups, and weak operator visibility.',
  'Make one clear offer: Xavira Control Stack combines Sovereign Engine and Sovereign Shield in one deployment.',
  'Keep the ask low-friction: offer a 15-20 minute operational risk audit and live control-stack walkthrough.',
  'Use proof language over hype: self-hosted, audit-ready, deployment-ready, operator-controlled, works above existing outbound tools, no fake customer claims.',
  'Write like a serious infrastructure operator: short sentences, specific business pain, calm confidence, no buzzword pileups, no AI-sounding filler.',
  'Preferred language: operational infrastructure, deliverability operations, provider-aware monitoring, infrastructure governance, realtime operational visibility, reputation monitoring, outbound reliability, AI governance systems, infrastructure intelligence.',
  'Avoid language that sounds like spam or hype: bulk email software, mass blasting, unlimited emails, growth hacks, AI spam system, send millions, scale instantly, buy today, limited time.',
  'Preserve deal value: internal enterprise license is $25,000; white-label commercial license is $75,000-$100,000+; maintenance is $3,000-$10,000/month.',
  'Use payment-plan language only as a conversion aid, never as the headline.',
  'Personalize from verified public evidence only; never invent a founder, campaign, revenue number, or private fact.',
  'Use social, LinkedIn, or competitor context only when it is present in the lead research payload; otherwise skip it.',
  'Never claim competitors are customers unless the lead record contains explicit competitor evidence.',
  'Every email must include a clear booking CTA and a polite opt-out line.',
]

const DIRECT_RULES = [
  'Direct offer: $25,000 internal enterprise license for Xavira Control Stack.',
  'Frame ROI as protecting outbound revenue, reducing failed follow-up waste, improving operator visibility, and lowering AI/compliance risk.',
  'Mention Sovereign Engine as the outbound operations control plane and Sovereign Shield as the private AI governance/security layer.',
  'Best CTA: 20-minute operational audit + deployment walkthrough.',
]

const AGENCY_RULES = [
  'Agency offer: $75,000-$100,000+ white-label commercial license.',
  'Frame it as a premium infrastructure product agencies, RevOps firms, MSSPs, and consultancies can deploy for clients.',
  'Mention white-label rights, reseller rights, commercial deployment rights, branding customization, multi-client deployment rights, and Xavira maintenance.',
  'Best CTA: white-label demo and licensing-fit review.',
]

const FOLLOW_UP_RULES = [
  'Sequence steps: Day 1 initial outreach, Day 3 stability follow-up, Day 5 operational visibility follow-up, Day 8 soft breakup.',
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
      ? '$75k-$100k+ white-label commercial-license value stack'
      : '$25k direct Xavira Control Stack value stack',
    'Low-friction audit/demo CTA with booking link',
    'Evidence-backed personalization only',
    'Compliance-safe opt-out and follow-up stop conditions',
  ]
}
