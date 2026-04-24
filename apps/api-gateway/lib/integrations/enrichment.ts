import { appEnv } from '@/lib/env'

export interface EnrichmentResult {
  provider: 'apollo' | 'clearbit' | 'none'
  data: Record<string, unknown> | null
}

async function tryFetchJson(
  url: string,
  init: RequestInit
): Promise<Record<string, unknown> | null> {
  const response = await fetch(url, init)
  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Enrichment request failed: ${body}`)
  }

  return (await response.json()) as Record<string, unknown>
}

async function enrichWithApollo(input: {
  email: string
  name?: string | null
  companyDomain?: string | null
}): Promise<EnrichmentResult | null> {
  const apiKey = appEnv.apolloApiKey()
  if (!apiKey) {
    return null
  }

  const payload = await tryFetchJson('https://api.apollo.io/api/v1/people/match', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify({
      email: input.email,
      name: input.name ?? undefined,
      domain: input.companyDomain ?? undefined,
      reveal_personal_emails: false,
    }),
  })

  return {
    provider: 'apollo',
    data: payload,
  }
}

export async function enrichContactProfile(input: {
  email: string
  name?: string | null
  companyDomain?: string | null
}) {
  const apolloResult = await enrichWithApollo(input)
  if (apolloResult) {
    return apolloResult
  }

  return {
    provider: 'none',
    data: null,
  } satisfies EnrichmentResult
}
