import { NextRequest, NextResponse } from 'next/server'
import {
  buildSovereignCopyForLead,
  inferSovereignOfferType,
  sovereignDealValueUsd,
  type SovereignCopyLead,
} from '@/lib/outbound-copy'

type PreviewLead = SovereignCopyLead & {
  label: string
}

const sampleLeads: PreviewLead[] = [
  {
    label: '$25k direct license',
    first_name: 'there',
    company: 'GrowthOps AI',
    companyDomain: 'growthops.ai',
    title: 'founder',
    reason_to_contact:
      'GrowthOps AI appears to run outbound and AI-powered sales workflows where domain health and PII safety matter.',
    customFields: {
      offer_type: 'direct',
      research_summary:
        'Relevant to outbound infrastructure, follow-up reliability, and private AI governance.',
    },
  },
  {
    label: '$100k agency master license',
    first_name: 'there',
    company: 'Northstar RevOps',
    companyDomain: 'northstarrevops.com',
    title: 'agency founder',
    reason_to_contact:
      'Northstar RevOps looks like a growth agency that could package outbound protection and AI governance for clients.',
    customFields: {
      offer_type: 'agency',
      industry: 'growth marketing agency',
      research_summary:
        'Agency lead; pitch white-label infrastructure and client monetization angle.',
    },
  },
]

function envEnabled(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

export async function GET(request: NextRequest) {
  const useAiPreview = request.nextUrl.searchParams.get('ai') === '1'
  const physicalAddress = process.env.SENDER_PHYSICAL_ADDRESS || 'Xavira Tech Labs, India'

  try {
    const previews = await Promise.all(
      sampleLeads.map(async (lead) => {
        const rendered = await buildSovereignCopyForLead(lead, {
          physicalAddress,
          useOpenRouter: useAiPreview,
        })
        const offerType = inferSovereignOfferType(lead)

        return {
          label: lead.label,
          offerType,
          dealValueUsd: sovereignDealValueUsd(lead),
          company: lead.company,
          subject: rendered.subject,
          text: rendered.text,
          source: rendered.source,
          error: rendered.error ?? null,
        }
      })
    )

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      aiPreview: useAiPreview,
      aiPersonalizationConfigured:
        Boolean(process.env.OPENROUTER_API_KEY || process.env.OPEN_ROUTER_API_KEY) &&
        envEnabled(process.env.OUTBOUND_OPENROUTER_COPY, true),
      retentionPolicy:
        'Recent sent-event bodies are retained for operator proof and sales review, then redacted by the outbound retention policy.',
      previews,
    })
  } catch (error) {
    console.error('[api/outbound/copy-preview] failed', error)
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 })
  }
}
