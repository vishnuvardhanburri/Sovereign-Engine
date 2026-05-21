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
  source: 'template' | 'openrouter'
  error?: string
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

export function sovereignDirectEmail1Body(): string {
  return `Hey {{FirstName}},

I noticed {{Company}} is running active outbound campaigns.

Most teams we speak with are losing leads because of:
* Warming domains getting burned
* AI tools leaking PII / sensitive data
* Compliance pressure (GDPR / DPDP)

We built Sovereign Stack - one $25,000 one-time license (Sovereign Engine + Sovereign Shield) that combines:
* Adaptive deliverability OS (protects your domains & inbox placement)
* Private AI Security Gateway (blocks prompt injection + masks PII)

Fully self-hosted, audit-ready, and works on top of Instantly, Smartlead, Apollo, etc.

Would you be open to a 20-minute audit + demo next week?

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

You run a strong lead generation / RevOps agency.

What if you could offer your clients a premium "Outbound Protection + Private AI Governance" product under your own brand?

Sovereign Stack Agency Master License - $100k one-time:
* Unlimited white-labeled deployments
* You charge clients $15k-$35k each
* We handle core licensing & backend updates

Many agencies recover the full $100k with just 5-8 clients.

Interested in seeing the white-label demo?

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

  return template
    .replaceAll('{{FirstName}}', firstName)
    .replaceAll('{{Company}}', company)
    .replaceAll('{{first_name}}', firstName)
    .replaceAll('{{company}}', company)
    .replaceAll('{{reason_to_contact}}', reason)
    .replaceAll('{{physical_address}}', physicalAddress)
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
    return {
      subject: fallbackSubject,
      text: withSovereignBookingCta(fallbackText),
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

  const result = await tryOpenRouterJson<{
    subject?: string
    body?: string
    reason?: string
  }>({
    task: 'sovereign_outbound_copy',
    system:
      'You write compliant B2B outbound email copy for a legitimate business interest outreach workflow. Return JSON only. Use the supplied Sovereign Sales Brain rules. Do not invent facts, customer names, revenue claims, urgency, or fake personalization. Keep it plain text, professional, pain-first, value-first, and under 170 words. Include a polite opt-out line.',
    user: JSON.stringify({
      salesBrain: buildSalesBrainContext(lead, offerType),
      recipient: {
        firstName,
        company,
        title: lead.title || null,
        companyDomain: lead.companyDomain || null,
        reasonToContact: reason,
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
    return {
      subject: fallbackSubject,
      text: withSovereignBookingCta(fallbackText),
      source: 'template',
      error: result.error,
    }
  }

  return {
    subject: cleanSubject(result.data.subject, fallbackSubject),
    text: cleanBody(result.data.body, fallbackText, options.physicalAddress),
    source: 'openrouter',
  }
}
