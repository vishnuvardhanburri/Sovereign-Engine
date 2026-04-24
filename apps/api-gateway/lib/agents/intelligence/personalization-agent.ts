import type { Contact, SequenceStep } from '@/lib/db/types'
import { renderVariables, enforceFiveLineEmail, detectSpamSignals } from '@/lib/personalization'
import { generateIntroLineLearned, generateSubjectLineLearned, renderSpinSyntax } from '@/lib/ai/generator'
import { enrichContactWithFreeData, formatEnrichmentForContext } from '@/lib/integrations/free-enrichment'
import { analyzeEmailForSpamRisk } from '@/lib/agents/spam-filter-agent'

export async function buildPersonalizedMessage(input: {
  contact: Contact
  step: Pick<SequenceStep, 'subject' | 'body'>
  offerSummary?: string | null
  painSummary?: string | null
  identityDomain?: string
  warmupReputation?: number
}) {
  // Auto-enrich contact with free data if not already enriched
  let enrichedContact = input.contact
  if (!input.contact.enrichment || Object.keys(input.contact.enrichment).length === 0) {
    const freeData = enrichContactWithFreeData({
      email: input.contact.email,
      name: input.contact.name,
      company: input.contact.company,
    })
    
    if (Object.keys(freeData).length > 0) {
      enrichedContact = {
        ...input.contact,
        enrichment: freeData as Record<string, unknown>,
      }
    }
  }

  const needsAiIntro = input.step.body.includes('{{AIIntro}}')
  const needsAiSubject = input.step.subject.includes('{{AISubject}}')
  let renderedBody = renderVariables(input.step.body, enrichedContact)
  let renderedSubject = renderVariables(input.step.subject, enrichedContact)
  const patternIds: string[] = []

  if (needsAiSubject) {
    const subjectOut = await generateSubjectLineLearned({
      contact: enrichedContact,
      angle: 'pattern',
    })
    const subject = subjectOut.result.subject as string
    const pid = subjectOut.result.pattern_id
    if (typeof pid === 'string' && pid) {
      patternIds.push(pid)
    }
    renderedSubject = renderVariables(
      input.step.subject.replaceAll('{{AISubject}}', subject),
      enrichedContact
    )
  }

  if (needsAiIntro) {
    const introOut = await generateIntroLineLearned({
      contact: enrichedContact,
      company: enrichedContact.company,
      role: enrichedContact.title,
      offer: input.offerSummary,
      pain: input.painSummary,
    })
    const intro = introOut.result.intro as string
    const pid = introOut.result.pattern_id
    if (typeof pid === 'string' && pid) {
      patternIds.push(pid)
    }

    renderedBody = renderVariables(
      input.step.body.replaceAll('{{AIIntro}}', intro),
      enrichedContact
    )
  }

  // Variations: support minimal deterministic spin syntax in both subject + body.
  // This avoids repetition while staying deterministic per contact.
  const spinSeed = `${enrichedContact.email}:${renderedSubject}:${renderedBody}`
  renderedSubject = renderSpinSyntax(renderedSubject, `${spinSeed}:subject`)
  renderedBody = renderSpinSyntax(renderedBody, `${spinSeed}:body`)

  // Analyze email for spam filter risk
  const spamAnalysis = analyzeEmailForSpamRisk({
    subject: renderedSubject,
    body: renderedBody,
    identity: {
      domain: input.identityDomain,
      reputation: input.warmupReputation,
    },
  })

  return {
    subject: renderedSubject,
    text: enforceFiveLineEmail(renderedBody),
    spamFlags: detectSpamSignals(`${renderedSubject}\n${renderedBody}`),
    spamAnalysis,
    enrichedContact,
    patternIds,
  }
}

export async function buildIntroLine(input: {
  company?: string | null
  role?: string | null
  offer?: string | null
  pain?: string | null
}) {
  const out = await generateIntroLineLearned({
    contact: {
      id: 0,
      client_id: 0,
      email: 'placeholder@example.com',
      email_domain: 'example.com',
      name: null,
      company: input.company ?? null,
      company_domain: null,
      title: input.role ?? null,
      timezone: null,
      source: null,
      custom_fields: {},
      enrichment: null,
      verification_status: 'unknown',
      verification_sub_status: null,
      status: 'active',
      unsubscribed_at: null,
      bounced_at: null,
      created_at: '',
      updated_at: '',
    },
    company: input.company,
    role: input.role,
    offer: input.offer,
    pain: input.pain,
  })
  return {
    intro: out.result.intro as string,
  }
}
