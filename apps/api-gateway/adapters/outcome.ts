import { getOutcomeSignals, getOutcomeDomain, getOutcomeCampaign, getOutcomeTrace } from '@sovereign/outcome-engine'
import { query } from '@/lib/db'

export async function getOutcomeSignalsAdapter(input: { clientId: number; domainId: number }) {
  return getOutcomeSignals({ db: query as any }, input)
}

export async function getOutcomeDomainAdapter(input: { clientId: number; domainId: number }) {
  return getOutcomeDomain({ db: query as any }, input)
}

export async function getOutcomeCampaignAdapter(input: { clientId: number; campaignId: number }) {
  return getOutcomeCampaign({ db: query as any }, input)
}

export async function getOutcomeTraceAdapter(input: { clientId: number; traceId: string }) {
  return getOutcomeTrace({ db: query as any }, input)
}

