import { tryOpenRouterJson } from '@/lib/ai/openrouter'
import { appEnv } from '@/lib/env'
import { buildSalesBrainContext } from '@/lib/sales-brain'

export type SovereignOfferType = 'direct' | 'agency'

export type SovereignCopyLead = {
  first_name?: string | null
  firstName?: string | null
  company?: string | null
  companyDomain?: string | null
  title?: string | null
  source?: string | null
  reason_to_contact?: string | null
  reasonToContact?: string | null
  offer_type?: string | null
  offerType?: string | null
  customFields?: Record<string, unknown> | null
}

export const SOVEREIGN_STACK_DIRECT_SUBJECT =
  'Quick check on your outbound deliverability + AI compliance?'

export const SOVEREIGN_STACK_AGENCY_SUBJECT =
  'White-label outbound + AI security product for your agency'

export const SOVEREIGN_BOOKING_URL = 'https://cal.com/vishnuvardhanburri/30min'

export function sovereignBookingCtaText(): string {
  return `Book a 20-minute audit + demo here: ${SOVEREIGN_BOOKING_URL}`
}

export function withSovereignBookingCta(body: string): string {
  const trimmed = body.trim()
  if (!trimmed || /cal\.com\/vishnuvardhanburri\/30min/i.test(trimmed)) {
    return trimmed
  }

  const cta = sovereignBookingCtaText()
  const optOutMatch = trimmed.match(
    /\n\nIf this is not relevant, reply "no" and I will not follow up\.$/i
  )
  if (optOutMatch?.index !== undefined) {
    return `${trimmed.slice(0, optOutMatch.index).trim()}\n\n${cta}${trimmed.slice(
      optOutMatch.index
    )}`
  }

  return `${trimmed}\n\n${cta}`
}

export type SovereignRenderedCopy = {
  subject: string
  text: string
  html: string
  source: 'template' | 'openrouter'
  error?: string
}

type LeadResearchContext = {
  evidenceUrl?: string
  linkedinUrl?: string
  linkedinPostUrl?: string
  socialSignal?: string
  competitorSignal?: string
  researchSummary?: string
}

export function inferSovereignOfferType(input: SovereignCopyLead): SovereignOfferType {
  const custom = input.customFields ?? {}
  const explicit = String(
    input.offer_type ?? input.offerType ?? custom.offer_type ?? custom.offerType ?? ''
  ).toLowerCase()
  if (explicit === 'agency' || explicit === 'agency_master') return 'agency'
  if (explicit === 'direct') return 'direct'

  const text = [
    input.company,
    input.companyDomain,
    input.title,
    input.source,
    input.reason_to_contact,
    input.reasonToContact,
    custom.industry,
    custom.segment,
    custom.persona,
  ]
    .map((value) => String(value ?? '').toLowerCase())
    .join(' ')

  if (
    /\bagency\b|\bagencies\b|marketing agency|performance marketing|digital marketing|growth marketing|seo agency|paid acquisition/.test(
      text
    )
  ) {
    return 'agency'
  }

  return 'direct'
}

function numericFitScore(input: SovereignCopyLead): number {
  const custom = input.customFields ?? {}
  const parsed = Number(custom.fit_score ?? custom.fitScore ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function sovereignDealValueUsd(input: SovereignCopyLead): number {
  return inferSovereignOfferType(input) === 'agency' ? 100000 : 25000
}

export function rankSovereignLeads<T extends SovereignCopyLead>(leads: T[]): T[] {
  return [...leads].sort((a, b) => {
    const valueDelta = sovereignDealValueUsd(b) - sovereignDealValueUsd(a)
    if (valueDelta !== 0) return valueDelta

    const fitDelta = numericFitScore(b) - numericFitScore(a)
    if (fitDelta !== 0) return fitDelta

    return String(a.company ?? a.companyDomain ?? '').localeCompare(
      String(b.company ?? b.companyDomain ?? '')
    )
  })
}

export function balanceSovereignOfferMix<T extends SovereignCopyLead>(
  leads: T[],
  limit: number
): T[] {
  const normalizedLimit = Math.max(0, Math.trunc(limit))
  if (normalizedLimit <= 0) return []

  const ranked = rankSovereignLeads(leads)
  const agency = ranked.filter((lead) => inferSovereignOfferType(lead) === 'agency')
  const direct = ranked.filter((lead) => inferSovereignOfferType(lead) === 'direct')
  const targetAgency = Math.ceil(normalizedLimit / 2)
  const targetDirect = normalizedLimit - targetAgency
  const selected = [
    ...agency.slice(0, targetAgency),
    ...direct.slice(0, targetDirect),
  ]
  const selectedSet = new Set(selected)
  const remainder = ranked.filter((lead) => !selectedSet.has(lead))

  return rankSovereignLeads([...selected, ...remainder.slice(0, normalizedLimit - selected.length)])
}

export function buildLeadResearchContext(lead: SovereignCopyLead): LeadResearchContext {
  const custom = lead.customFields ?? {}
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = String(custom[key] ?? '').trim()
      if (value) return value.slice(0, 320)
    }
    return undefined
  }

  return {
    evidenceUrl: pick('research_evidence_url', 'public_evidence_url', 'source_url'),
    linkedinUrl: pick('linkedin_url', 'linkedin', 'linkedinUrl'),
    linkedinPostUrl: pick('linkedin_post_url', 'recent_linkedin_post_url', 'linkedinPostUrl'),
    socialSignal: pick('social_signal', 'recent_social_signal', 'social_context'),
    competitorSignal: pick('competitor_signal', 'competitor_context', 'category_signal'),
    researchSummary: pick('research_summary', 'reason_to_contact', 'why_now'),
  }
}

export function sovereignDirectEmail1Body(): string {
  return `Hey {{FirstName}},

{{pain_line}}

The business case is simple: if {{Company}} is paying for outbound but replies slow down, every campaign gets more expensive while pipeline quality drops.

Sovereign Stack is a $25,000 one-time license built to protect that ROI:
* Sovereign Engine keeps domains, pacing, follow-ups, and inbox placement under control
* Sovereign Shield keeps AI personalization private, masks PII, and leaves audit proof

The expected win: fewer burned domains, safer AI usage, cleaner follow-ups, and a controlled outbound system instead of another fragile tool stack.

Worth a quick audit for {{Company}}?

${sovereignBookingCtaText()}

Best regards,
Vishnu
Xavira Tech Labs
Sovereign Stack

{{physical_address}}

If this is not relevant, reply "no" and I will not follow up.`
}

export function sovereignAgencyEmail1Body(): string {
  return `Hey {{FirstName}},

{{pain_line}}

Your clients can buy more leads, but if domains burn or AI workflows leak sensitive data, campaigns stall and retainers get questioned.

The profit case: Sovereign Stack lets you sell infrastructure, not just services.

Sovereign Stack Agency Master License - $100k one-time:
* Unlimited white-labeled deployments
* You charge clients $15k-$35k each
* We handle core licensing & backend updates

The expected win: recover the license with 5-8 client deployments, improve campaign reliability, and add a premium AI governance layer your competitors are not packaging yet.

Want to see the white-label demo for {{Company}}?

${sovereignBookingCtaText()}

Best regards,
Vishnu
Xavira Tech Labs
Sovereign Stack

{{physical_address}}

If this is not relevant, reply "no" and I will not follow up.`
}

export const SOVEREIGN_STACK_DIRECT_SEQUENCE_STEPS = [
  {
    id: 'sovereign-stack-step-1',
    day: 0,
    subject: SOVEREIGN_STACK_DIRECT_SUBJECT,
    body: sovereignDirectEmail1Body(),
  },
  {
    id: 'sovereign-stack-step-2',
    day: 4,
    subject: 'Re: Your outbound + AI risk',
    body: `Hey {{FirstName}},

Following up.

We're helping outbound teams and agencies worldwide stabilize their infrastructure while adding strong AI governance - especially important in EU and India right now.

Curious - are you currently facing any deliverability drops or concerns around AI data leakage?

Happy to run a free 15-min risk check for {{Company}} if useful.

${sovereignBookingCtaText()}

Best regards,
Vishnu
Xavira Tech Labs
Sovereign Stack

{{physical_address}}

If this is not relevant, reply "no" and I will not follow up.`,
  },
  {
    id: 'sovereign-stack-step-3',
    day: 7,
    subject: '$25k Sovereign Stack + payment plan option',
    body: `Hey {{FirstName}},

Last note on this.

We're offering the Sovereign Stack at $25,000 one-time (includes 12 months updates + deployment support).

We can also split it into 3 payments of ~$8,500 if that helps.

Would you like to see the dashboard live and get a custom risk report for your current setup?

${sovereignBookingCtaText()}

Best regards,
Vishnu
Xavira Tech Labs
Sovereign Stack

{{physical_address}}

If this is not relevant, reply "no" and I will not follow up.`,
  },
  {
    id: 'sovereign-stack-step-4',
    day: 11,
    subject: '{{Company}} outbound infrastructure',
    body: `Hey {{FirstName}},

Still interested in protecting your outbound revenue and locking down AI usage?

No pressure - just let me know if you want the 20-min demo or if I should stop following up.

${sovereignBookingCtaText()}

Best regards,
Vishnu
Xavira Tech Labs
Sovereign Stack

{{physical_address}}

If this is not relevant, reply "no" and I will not follow up.`,
  },
  {
    id: 'sovereign-stack-step-5',
    day: 16,
    subject: 'Final note - Sovereign Stack for {{Company}}',
    body: `Hey {{FirstName}},

Last email.

If you're planning to scale outbound this year, Sovereign Stack is one of the highest-ROI infrastructure decisions you can make right now.

Reply "DEMO" if you want to schedule a quick call.

${sovereignBookingCtaText()}

Thanks,
Vishnu
Xavira Tech Labs
Sovereign Stack

{{physical_address}}

If this is not relevant, reply "no" and I will not follow up.`,
  },
]

export function sovereignSubjectForLead(lead: SovereignCopyLead): string {
  return inferSovereignOfferType(lead) === 'agency'
    ? SOVEREIGN_STACK_AGENCY_SUBJECT
    : SOVEREIGN_STACK_DIRECT_SUBJECT
}

export function sovereignBodyForLead(lead: SovereignCopyLead): string {
  return inferSovereignOfferType(lead) === 'agency'
    ? sovereignAgencyEmail1Body()
    : sovereignDirectEmail1Body()
}

function safeGreetingName(value: string | null | undefined): string {
  const name = String(value || '').trim()
  if (!name) return 'there'

  const normalized = name.toLowerCase()
  const genericInboxNames = new Set([
    'admin',
    'business',
    'contact',
    'hello',
    'hi',
    'info',
    'mail',
    'marketing',
    'office',
    'opportunity',
    'ops',
    'partnership',
    'partnerships',
    'sales',
    'support',
    'team',
  ])

  if (genericInboxNames.has(normalized)) return 'there'
  if (!/^[a-z][a-z' -]{1,40}$/i.test(name)) return 'there'

  return name
}

export function renderSovereignTemplate(
  template: string,
  lead: SovereignCopyLead,
  physicalAddress: string
): string {
  const firstName = safeGreetingName(lead.first_name || lead.firstName)
  const company = lead.company || lead.companyDomain || 'your team'
  const reason =
    lead.reason_to_contact ||
    lead.reasonToContact ||
    'your team works around outbound or growth infrastructure'
  const painLine = buildSovereignPainLine(lead)

  return template
    .replaceAll('{{FirstName}}', firstName)
    .replaceAll('{{Company}}', company)
    .replaceAll('{{first_name}}', firstName)
    .replaceAll('{{company}}', company)
    .replaceAll('{{reason_to_contact}}', reason)
    .replaceAll('{{pain_line}}', painLine)
    .replaceAll('{{physical_address}}', physicalAddress)
}

function compactSentence(value: string, fallback: string): string {
  const cleaned = value
    .replace(/\s+/g, ' ')
    .replace(/[<>]/g, '')
    .trim()
  if (!cleaned) return fallback
  const sentence = cleaned.replace(/[.?!]*$/, '.')
  return sentence.length > 220 ? `${sentence.slice(0, 217).trim()}...` : sentence
}

export function buildSovereignPainLine(lead: SovereignCopyLead): string {
  const company = lead.company || lead.companyDomain || 'your team'
  const reason =
    lead.reason_to_contact ||
    lead.reasonToContact ||
    buildLeadResearchContext(lead).researchSummary ||
    ''
  const context = buildLeadResearchContext(lead)
  const offerType = inferSovereignOfferType(lead)

  if (context.socialSignal) {
    return compactSentence(
      `I noticed ${company} is active around ${context.socialSignal}; that usually means outbound reliability and AI data handling start affecting revenue, not just operations.`,
      `I noticed ${company} is scaling outbound, where deliverability and AI data handling can quietly decide campaign ROI.`
    )
  }

  if (context.competitorSignal) {
    return compactSentence(
      `I noticed ${company} sits in a category where ${context.competitorSignal}; that makes outbound reliability and private AI governance a revenue problem, not a tooling problem.`,
      `I noticed ${company} is in a market where outbound reliability and private AI governance can become a revenue edge.`
    )
  }

  if (reason) {
    return compactSentence(
      `I noticed ${company} because ${reason}; that is exactly where domain health, follow-up control, and AI data safety can either protect pipeline or quietly leak revenue.`,
      `I noticed ${company} is working around outbound, where domain health and AI data safety can quietly decide reply quality.`
    )
  }

  if (offerType === 'agency') {
    return `I noticed ${company} serves growth or RevOps clients; when client campaigns miss replies because domains degrade or AI handling feels risky, the agency gets blamed before the tool stack does.`
  }

  return `I noticed ${company} is a fit for outbound-led growth; when domain health drops or AI workflows touch sensitive data, pipeline cost rises before the team sees the root cause.`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderTextBlock(block: string): string {
  const lines = block.split('\n').map((line) => line.trim()).filter(Boolean)
  if (lines.length > 0 && lines.every((line) => line.startsWith('* '))) {
    return `<ul style="margin:0 0 16px 20px;padding:0;color:#111827;">${lines
      .map((line) => `<li style="margin:0 0 6px 0;">${escapeHtml(line.slice(2))}</li>`)
      .join('')}</ul>`
  }

  return `<p style="margin:0 0 16px 0;color:#111827;line-height:1.55;">${lines
    .map(escapeHtml)
    .join('<br>')}</p>`
}

export function renderSovereignHtmlEmail(text: string): string {
  const blocks = text.trim().split(/\n{2,}/)
  const htmlBlocks = blocks
    .map((block) => {
      if (block.includes(SOVEREIGN_BOOKING_URL)) {
        return `<p style="margin:20px 0 18px 0;"><a href="${SOVEREIGN_BOOKING_URL}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;padding:10px 14px;font-weight:700;font-size:14px;">Book 20-min audit</a></p><p style="margin:0 0 16px 0;color:#6b7280;font-size:12px;">Or open: <a href="${SOVEREIGN_BOOKING_URL}" style="color:#2563eb;">${SOVEREIGN_BOOKING_URL}</a></p>`
      }

      return renderTextBlock(block)
    })
    .join('')

  return `<!doctype html><html><body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#111827;"><div style="max-width:620px;margin:0 auto;padding:24px;">${htmlBlocks}</div></body></html>`
}

function envEnabled(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function cleanSubject(value: unknown, fallback: string): string {
  const subject = String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!subject || subject.length > 120) return fallback
  return subject
}

function cleanBody(value: unknown, fallback: string, physicalAddress: string): string {
  let body = String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (!body || body.length < 120 || body.length > 2_400) return fallback
  if (!/vishnu/i.test(body)) body += '\n\nBest regards,\nVishnu\nXavira Tech Labs'
  body = withSovereignBookingCta(body)
  if (!body.includes(physicalAddress)) body += `\n${physicalAddress}`
  if (!/reply\s+"?no"?|do not follow up|not relevant/i.test(body)) {
    body += '\n\nIf this is not relevant, reply "no" and I will not follow up.'
  }

  return body
}

export async function buildSovereignCopyForLead(
  lead: SovereignCopyLead,
  options: {
    physicalAddress: string
    subjectOverride?: string
    bodyOverride?: string
    useOpenRouter?: boolean
  }
): Promise<SovereignRenderedCopy> {
  const fallbackSubject = options.subjectOverride || sovereignSubjectForLead(lead)
  const fallbackTemplate = options.bodyOverride || sovereignBodyForLead(lead)
  const fallbackText = renderSovereignTemplate(
    fallbackTemplate,
    lead,
    options.physicalAddress
  )
  const openRouterApiKey = appEnv.openRouterApiKey()
  const shouldUseOpenRouter =
    options.useOpenRouter ??
    (Boolean(openRouterApiKey) &&
      envEnabled(process.env.OUTBOUND_OPENROUTER_COPY, true))

  if (!shouldUseOpenRouter) {
    const text = withSovereignBookingCta(fallbackText)
    return {
      subject: fallbackSubject,
      text,
      html: renderSovereignHtmlEmail(text),
      source: 'template',
    }
  }

  const offerType = inferSovereignOfferType(lead)
  const company = lead.company || lead.companyDomain || 'the company'
  const reason =
    lead.reason_to_contact ||
    lead.reasonToContact ||
    'the company appears relevant to outbound infrastructure or AI security'
  const firstName = safeGreetingName(lead.first_name || lead.firstName)
  const researchContext = buildLeadResearchContext(lead)

  const result = await tryOpenRouterJson<{
    subject?: string
    body?: string
    reason?: string
  }>({
    task: 'sovereign_outbound_copy',
    system:
      'You write compliant B2B outbound email copy for a legitimate business interest outreach workflow. Return JSON only. Use the supplied Sovereign Sales Brain rules. Do not invent facts, customer names, revenue claims, urgency, or fake personalization. Write like a real operator sending a one-to-one note: short, specific, plain text, pain-first, and useful. No hype, no emojis, no spam tricks, no fake competitor claims. Keep it under 150 words. Include a polite opt-out line.',
    user: JSON.stringify({
      salesBrain: buildSalesBrainContext(lead, offerType),
      recipient: {
        firstName,
        company,
        title: lead.title || null,
        companyDomain: lead.companyDomain || null,
        reasonToContact: reason,
        researchContext,
      },
      offer:
        offerType === 'agency'
          ? {
              name: 'Sovereign Stack Agency Master License',
              price: '$100k one-time',
              positioning:
                'white-label outbound protection plus private AI governance for agencies',
              bullets: [
                'Unlimited white-labeled deployments',
                'Agency can charge clients $15k-$35k each',
                'Core licensing and backend updates handled by Xavira Tech Labs',
              ],
            }
          : {
              name: 'Sovereign Stack',
              price: '$25,000 one-time license',
              positioning:
                'outbound deliverability protection plus private AI security gateway',
              bullets: [
                'Adaptive deliverability OS for domain and inbox placement protection',
                'Private AI Security Gateway for prompt-injection protection and PII masking',
                'Self-hosted, audit-ready, works above Instantly, Smartlead, Apollo, and similar tools',
              ],
            },
      requiredSignature: ['Best regards', 'Vishnu', 'Xavira Tech Labs', 'Sovereign Stack'],
      physicalAddress: options.physicalAddress,
      fallbackSubject,
      writingRules: [
        'Use at most one evidence-backed personalization line.',
        'Answer the buyer question clearly: why buy, what profit or risk reduction they should expect, and why this matters now.',
        'Lead with the company pain before mentioning the product.',
        'If researchContext has LinkedIn or social context, use it naturally in one sentence.',
        'If competitorSignal exists, phrase it as a category trend, not as a fake customer claim.',
        'Keep the email short, useful, and human; avoid brochure language.',
        'Use one clear ask and one booking link only.',
        'Explain the product benefit in simple words: safer outbound, cleaner follow-ups, reduced AI data leak risk.',
      ],
    }),
    fallback: {
      subject: fallbackSubject,
      body: fallbackText,
      reason: 'fallback_template',
    },
    apiKey: openRouterApiKey,
    timeoutMs: 5_000,
  })

  if (result.source !== 'openrouter') {
    const text = withSovereignBookingCta(fallbackText)
    return {
      subject: fallbackSubject,
      text,
      html: renderSovereignHtmlEmail(text),
      source: 'template',
      error: result.error,
    }
  }

  const text = cleanBody(result.data.body, fallbackText, options.physicalAddress)
  return {
    subject: cleanSubject(result.data.subject, fallbackSubject),
    text,
    html: renderSovereignHtmlEmail(text),
    source: 'openrouter',
  }
}
