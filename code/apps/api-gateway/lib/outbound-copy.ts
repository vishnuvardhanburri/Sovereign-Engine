import { tryOpenRouterJson } from '@/lib/ai/openrouter'
import { appEnv } from '@/lib/env'
import { buildSalesBrainContext } from '@/lib/sales-brain'
import {
  XAVIRA_COMMERCIAL_MODEL,
  commercialDealValueGbp,
} from '@/lib/commercial-model'

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
  'quick deliverability question'

export const SOVEREIGN_STACK_AGENCY_SUBJECT =
  'white-label outbound infrastructure'

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
  return commercialDealValueGbp(inferSovereignOfferType(input))
}

export const sovereignDealValueGbp = sovereignDealValueUsd

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
  return `Hi {{FirstName}},

{{pain_line}}

Quick question - are you still seeing stable inbox placement at current sending volume, or starting to hit reputation/spam-folder issues?

A lot of outbound-heavy teams run into the same operational problems once volume scales:
* Gmail/Outlook throttling
* domain burn
* queue instability
* weak follow-up visibility
* AI personalization touching sensitive data without enough governance

At Xavira Tech Labs, we built Xavira Control Stack - Sovereign Engine plus Sovereign Shield - to monitor and stabilize outbound operations before those issues become expensive.

If useful, I can run a short outbound infrastructure review for {{Company}} and show where the risk sits.

${sovereignBookingCtaText()}

Best,
Vishnu
Founder - Xavira Tech Labs
Xavira Tech Labs

{{physical_address}}

If this is not relevant, reply "no" and I will not follow up.`
}

export function sovereignAgencyEmail1Body(): string {
  return `Hi {{FirstName}},

{{pain_line}}

I came across {{Company}} and noticed you operate around outbound, growth, RevOps, or client acquisition infrastructure.

At Xavira Tech Labs, we built:
* Sovereign Engine
* Sovereign Shield

Together they form Xavira Control Stack - enterprise outbound infrastructure and operational governance for teams that need more than campaign execution.

We are opening a limited number of white-label commercial licensing conversations:
* white-label rights
* reseller rights
* commercial deployment rights
* branding customization
* multi-client deployment support
* ${XAVIRA_COMMERCIAL_MODEL.operationsMaintenance.label} GBP operations and maintenance support

The reason to buy: it gives agencies and operators a premium infrastructure product to deploy for clients, not just another outbound service line.

Commercial licensing is ${XAVIRA_COMMERCIAL_MODEL.whiteLabelCommercialLicense.label} GBP when white-label and reseller rights are included.

Would be open to a short conversation if this aligns with {{Company}}'s roadmap?

${sovereignBookingCtaText()}

Best,
Vishnu
Xavira Tech Labs
Xavira Control Stack

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
    day: 3,
    subject: 'following up',
    body: `Hi {{FirstName}},

Just wanted to follow up on my earlier note.

A lot of outbound teams look healthy initially, but once sending volume increases:
* inbox placement drops
* provider throttling increases
* reply rates collapse
* domains slowly burn

That operational layer is exactly what we focus on at Xavira Tech Labs.

Happy to share a quick infrastructure review if useful.

${sovereignBookingCtaText()}

Best,
Vishnu
Xavira Tech Labs
Xavira Control Stack

{{physical_address}}

If this is not relevant, reply "no" and I will not follow up.`,
  },
  {
    id: 'sovereign-stack-step-3',
    day: 5,
    subject: 'worth a quick look?',
    body: `Hi {{FirstName}},

Wanted to send one final follow-up.

We built Sovereign Engine specifically for:
* outbound infrastructure visibility
* provider-aware monitoring
* reputation protection
* safer outbound scaling
* operational governance

Most teams only notice deliverability problems after performance drops.

Happy to show a short walkthrough if relevant.

${sovereignBookingCtaText()}

Best,
Vishnu
Xavira Tech Labs
Xavira Control Stack

{{physical_address}}

If this is not relevant, reply "no" and I will not follow up.`,
  },
  {
    id: 'sovereign-stack-step-4',
    day: 8,
    subject: 'closing the loop',
    body: `Hi {{FirstName}},

I will close the loop here.

If outbound reliability, infrastructure governance, or deliverability monitoring becomes relevant later, happy to reconnect.

Wishing you and {{Company}} continued growth.

${sovereignBookingCtaText()}

Best,
Vishnu
Xavira Tech Labs
Xavira Control Stack

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
    'feedback',
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

function companyFromDomain(domain: string): string {
  const base = String(domain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('.')[0]
    .replace(/[-_]+/g, ' ')
    .trim()

  return base
    ? base.replace(/\b\w/g, (letter) => letter.toUpperCase())
    : 'your team'
}

function looksLikeContentTitle(value: string): boolean {
  const text = value.toLowerCase()
  return /\b(?:introduction|intro|guide|tutorial|course|training|learn|what is|types of|explained|best practices|resources?|definition|article|blog|news)\b/.test(
    text
  )
}

function safeCompanyName(lead: SovereignCopyLead): string {
  const rawCompany = String(lead.company || '').trim()
  const domain = String(lead.companyDomain || '').trim()
  if (rawCompany && !looksLikeContentTitle(rawCompany)) return rawCompany
  if (domain) return companyFromDomain(domain)
  return rawCompany || 'your team'
}

export function renderSovereignTemplate(
  template: string,
  lead: SovereignCopyLead,
  physicalAddress: string
): string {
  const firstName = safeGreetingName(lead.first_name || lead.firstName)
  const company = safeCompanyName(lead)
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function humanizeReasonForPainLine(reason: string, company: string): string {
  const withoutCompany = reason
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s*·\s*/g, ' ')
    .replace(/^public search result matched .*? target profile:\s*/i, '')
    .replace(/\bPublic domain and MX records confirm the business domain\b[^.?!]*(?:[.?!]|$)/gi, '')
    .replace(/\bselected safe [a-z -]*inbox\b[^.?!]*(?:[.?!]|$)/gi, '')
    .replace(/\bvalidation and bounce controls remain active\b[^.?!]*(?:[.?!]|$)/gi, '')
    .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, '')
    .replace(new RegExp(`^${escapeRegExp(company)}\\s+`, 'i'), '')
    .replace(/^.*because it shows public signals around\s+/i, '')
    .replace(/^.*because\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.?!]*$/, '')

  if (looksLikeContentTitle(withoutCompany)) return `${company} is active around a relevant business category`
  if (!withoutCompany) return `${company} is active around outbound or growth`
  if (/^(appears|looks|seems|runs|serves|works|offers|has|is)\b/i.test(withoutCompany)) {
    return `${company} ${withoutCompany}`
  }

  return `${company} shows public signals around ${withoutCompany}`
}

export function buildSovereignPainLine(lead: SovereignCopyLead): string {
  const company = safeCompanyName(lead)
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
    const humanReason = humanizeReasonForPainLine(reason, company)
    return compactSentence(
      `I noticed ${humanReason}. That is exactly where domain health, follow-up control, and AI data safety can either protect pipeline or quietly leak revenue.`,
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
      envEnabled(process.env.OUTBOUND_OPENROUTER_COPY, false))

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

  const aiPayload = JSON.stringify({
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
            name: 'Xavira Control Stack White-Label Commercial License',
            price: `${XAVIRA_COMMERCIAL_MODEL.whiteLabelCommercialLicense.label} GBP`,
            positioning:
              'white-label outbound operations and private AI governance infrastructure for agencies, RevOps firms, MSSPs, and consultancies',
            bullets: [
              'White-label rights, reseller rights, and commercial deployment rights',
              'Branding customization across dashboards and control surfaces',
              'Xavira core updates, deployment support, and maintenance options',
            ],
          }
        : {
            name: 'Xavira Control Stack Internal Enterprise License',
            price: `${XAVIRA_COMMERCIAL_MODEL.internalEnterpriseLicense.label} GBP`,
            positioning:
              'owned outbound operations control plane plus private AI governance layer',
            bullets: [
              'Sovereign Engine for domain health, queue pressure, follow-ups, and delivery proof',
              'Sovereign Shield for private AI handling, PII masking, and audit evidence',
              'Deployment-ready dashboards, desktop apps, mobile apps, and operating reports',
            ],
          },
    requiredSignature: ['Best regards', 'Vishnu', 'Xavira Tech Labs', 'Xavira Control Stack'],
    physicalAddress: options.physicalAddress,
    fallbackSubject,
    writingRules: [
      'Start directly with the most specific verified context available. Avoid "hope you are well" and generic intros.',
      'Use a lower-case, short subject when possible; no salesy words, no excessive punctuation, no spam-trigger wording.',
      'Use at most one evidence-backed personalization line.',
      'Answer the buyer question clearly: why buy, what profit or risk reduction they should expect, and why this matters now.',
      'Lead with the company pain before mentioning the product.',
      'Make the ask feel helpful: a 20-minute audit that maps risks and gives a 3-step action plan.',
      'If researchContext has LinkedIn or social context, use it naturally in one sentence.',
      'If competitorSignal exists, phrase it as a category trend, not as a fake customer claim.',
      'Keep the email short, useful, and human; avoid brochure language.',
      'Use one clear ask and one booking link only.',
      'Explain the product benefit in simple words: owned control, safer outbound, cleaner follow-ups, reduced AI data leak risk, and stronger client trust.',
    ],
  })
  const aiSystem =
    'You write compliant B2B enterprise outbound email copy for a legitimate business interest workflow. Return JSON only with subject and body. Use the supplied Sovereign Sales Brain rules. Position Xavira Tech Labs as a premium infrastructure vendor. Do not invent facts, customer names, revenue claims, urgency, fake personalization, or competitor customer claims. Write like a serious operator sending a one-to-one note: short, specific, plain text, pain-first, and useful. No hype, no emojis, no spam tricks, no bypass language. Keep it under 150 words. Include a polite opt-out line. Structure: verified evidence hook, operational pain, why Xavira Control Stack helps, low-friction audit CTA.'

  const result = shouldUseOpenRouter
    ? await tryOpenRouterJson<{
        subject?: string
        body?: string
        reason?: string
      }>({
        task: 'sovereign_outbound_copy',
        system: aiSystem,
        user: aiPayload,
        fallback: {
          subject: fallbackSubject,
          body: fallbackText,
          reason: 'fallback_template',
        },
        apiKey: openRouterApiKey,
        timeoutMs: 5_000,
      })
    : {
        source: 'fallback' as const,
        data: {
          subject: fallbackSubject,
          body: fallbackText,
          reason: 'openrouter_disabled',
        },
        error: 'openrouter_disabled',
  }

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
