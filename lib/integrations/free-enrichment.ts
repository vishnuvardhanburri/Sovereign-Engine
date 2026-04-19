/**
 * Free enrichment: extract company, infer title, build LinkedIn URL
 * No API costs — purely pattern-based and domain lookup
 */

interface FreeEnrichmentData {
  company?: string
  title?: string
  linkedinUrl?: string
  industry?: string
}

function extractCompanyFromDomain(email: string): string | undefined {
  const domainMatch = email.match(/@([^@]+)\./)
  if (!domainMatch) return undefined
  
  const domain = domainMatch[1]
  
  // Skip common email domains
  if (['gmail', 'yahoo', 'outlook', 'hotmail', 'aol', 'protonmail', 'icloud'].includes(domain.toLowerCase())) {
    return undefined
  }
  
  // Convert domain to company name
  return domain
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function inferTitleFromEmail(email: string, nameHint?: string): string | undefined {
  const localPart = email.split('@')[0].toLowerCase()
  
  // Pattern: john.smith → likely individual contributor
  if (localPart.includes('.')) {
    // Check common prefixes
    if (localPart.includes('ceo') || localPart.includes('founder')) return 'CEO/Founder'
    if (localPart.includes('cto')) return 'CTO'
    if (localPart.includes('director')) return 'Director'
    if (localPart.includes('manager')) return 'Manager'
    if (localPart.includes('sales')) return 'Sales'
    if (localPart.includes('marketing')) return 'Marketing'
    if (localPart.includes('dev') || localPart.includes('engineer')) return 'Engineering'
    
    // Generic individual
    return 'Professional'
  }
  
  // Pattern: info@, contact@, hello@ → likely company account
  const genericPatterns = ['info', 'contact', 'hello', 'support', 'team', 'noreply', 'mail']
  if (genericPatterns.includes(localPart)) {
    return undefined
  }
  
  return undefined
}

function buildLinkedInUrl(name?: string, company?: string): string | undefined {
  if (!name) return undefined
  
  const nameParts = name
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  
  if (nameParts.length === 0) return undefined
  
  // Build basic LinkedIn URL pattern
  const urlName = nameParts.join('-')
  
  if (company) {
    const companySlug = company
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
    
    return `https://www.linkedin.com/search/results/people/?keywords=${urlName}%20${companySlug}`
  }
  
  return `https://www.linkedin.com/search/results/people/?keywords=${urlName}`
}

function inferIndustry(domain?: string, company?: string): string | undefined {
  const searchText = (domain || company || '').toLowerCase()
  
  // Simple industry detection
  const industryPatterns: Record<string, string> = {
    'finance|fintech|bank': 'Financial Services',
    'health|medical|pharma': 'Healthcare',
    'tech|software|app|saas': 'Technology',
    'retail|ecommerce|shop': 'Retail',
    'real estate|property|realty': 'Real Estate',
    'legal|law': 'Legal Services',
    'market|advert|pr|agency': 'Marketing & Advertising',
    'manufacture|industrial|factory': 'Manufacturing',
    'education|school|university|learning': 'Education',
  }
  
  for (const [pattern, industry] of Object.entries(industryPatterns)) {
    if (new RegExp(pattern).test(searchText)) {
      return industry
    }
  }
  
  return undefined
}

export function enrichContactWithFreeData(input: {
  email: string
  name?: string | null
  company?: string | null
}): FreeEnrichmentData {
  const enrichment: FreeEnrichmentData = {}
  
  // Extract company from domain if not provided
  if (!input.company) {
    const domainCompany = extractCompanyFromDomain(input.email)
    if (domainCompany) {
      enrichment.company = domainCompany
    }
  } else {
    enrichment.company = input.company
  }
  
  // Infer title from email pattern
  const inferredTitle = inferTitleFromEmail(input.email, input.name ?? undefined)
  if (inferredTitle) {
    enrichment.title = inferredTitle
  }
  
  // Build LinkedIn URL
  const linkedinUrl = buildLinkedInUrl(input.name ?? undefined, enrichment.company)
  if (linkedinUrl) {
    enrichment.linkedinUrl = linkedinUrl
  }
  
  // Infer industry
  const industry = inferIndustry(enrichment.company)
  if (industry) {
    enrichment.industry = industry
  }
  
  return enrichment
}

export function formatEnrichmentForContext(data: FreeEnrichmentData): string {
  const parts: string[] = []
  
  if (data.company) parts.push(`Company: ${data.company}`)
  if (data.title) parts.push(`Title: ${data.title}`)
  if (data.industry) parts.push(`Industry: ${data.industry}`)
  if (data.linkedinUrl) parts.push(`LinkedIn: ${data.linkedinUrl}`)
  
  return parts.join(' | ')
}
