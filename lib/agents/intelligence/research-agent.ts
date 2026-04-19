export interface CompanyInsight {
  company: string | null
  summary: string
  strength: string
}

export async function gatherCompanyInsights(input: {
  company?: string | null
  domain?: string | null
}): Promise<CompanyInsight> {
  const company = input.company?.trim() || input.domain || 'the target organization'
  const summary = input.company
    ? `Research indicates ${company} is navigating a competitive market and values measurable growth.`
    : `Research indicates the target organization is investment-focused and aims to improve response efficiency.`

  return {
    company: input.company ?? null,
    summary,
    strength: input.company ? 'company-context' : 'market-context',
  }
}
