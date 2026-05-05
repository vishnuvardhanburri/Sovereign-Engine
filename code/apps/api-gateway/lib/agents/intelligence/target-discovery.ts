/**
 * TARGET DISCOVERY ENGINE - Identifies and ranks high-value leads
 *
 * Discovers:
 * - Companies matching ICP criteria
 * - Decision makers (personas)
 * - Key contextual data (recent funding, hiring, product changes)
 * - Ranked by fit score and value
 */

import type { ICPDefinition, TargetPerson } from './intent-engine'

export interface TargetCompany {
  id: string
  name: string
  domain: string
  industry: string
  size: number
  revenue?: number
  funding?: {
    stage: string
    amount?: number
    date?: string
  }
  recentActivity: {
    newHiring?: boolean
    fundingRound?: boolean
    productLaunch?: boolean
    expansionMove?: boolean
  }
  techStack?: string[]
  engagementScore: number // 0-100
}

export interface LeadPerson {
  firstName: string
  lastName: string
  email: string
  title: string
  company: TargetCompany
  role: string // CEO, CTO, VP Sales, etc.
  linkedinUrl?: string
  fitScore: number // 0-100
  personalizationHooks: string[]
}

export interface DiscoveredLeadSet {
  companies: TargetCompany[]
  leads: LeadPerson[]
  totalDiscovered: number
  avgEngagementScore: number
  topLeads: LeadPerson[] // Top 20 by fit score
}

/**
 * Discover leads matching ICP and personas
 * In production, integrates with RocketReach, Apollo.io, Hunter, etc.
 */
export async function discoverLeads(
  icp: ICPDefinition,
  targetPersonas: TargetPerson[],
  limit: number = 500
): Promise<DiscoveredLeadSet> {
  // Simulate lead discovery from databases
  // In production: Query Apollo, RocketReach, Hunter APIs

  const companies = await discoverCompanies(icp, limit)
  const leads = await identifyPersonasInCompanies(companies, targetPersonas)

  const topLeads = leads.sort((a, b) => b.fitScore - a.fitScore).slice(0, 20)

  return {
    companies,
    leads,
    totalDiscovered: leads.length,
    avgEngagementScore: leads.reduce((a, l) => a + l.company.engagementScore, 0) / leads.length,
    topLeads,
  }
}

/**
 * Discover companies matching ICP
 * Simulated - would integrate with data providers
 */
async function discoverCompanies(icp: ICPDefinition, limit: number): Promise<TargetCompany[]> {
  const companies: TargetCompany[] = []

  // Simulate discovery across industries
  const industrySeeds: Record<string, TargetCompany[]> = {
    saas: [
      {
        id: 'comp-001',
        name: 'CloudSync Inc',
        domain: 'cloudsync.io',
        industry: 'SaaS',
        size: 150,
        revenue: 5000000,
        funding: { stage: 'Series B', amount: 25000000, date: '2024-01-15' },
        recentActivity: {
          newHiring: true,
          fundingRound: true,
          productLaunch: true,
          expansionMove: false,
        },
        techStack: ['React', 'Node.js', 'PostgreSQL', 'AWS'],
        engagementScore: 0,
      },
      {
        id: 'comp-002',
        name: 'DataFlow Systems',
        domain: 'dataflow.ai',
        industry: 'SaaS',
        size: 45,
        revenue: 500000,
        funding: { stage: 'Seed', amount: 2000000, date: '2023-06-20' },
        recentActivity: {
          newHiring: true,
          fundingRound: false,
          productLaunch: false,
          expansionMove: true,
        },
        techStack: ['Python', 'Terraform', 'GCP'],
        engagementScore: 0,
      },
      {
        id: 'comp-003',
        name: 'SecureVault Pro',
        domain: 'securevaultpro.com',
        industry: 'SaaS',
        size: 280,
        revenue: 12000000,
        funding: { stage: 'Series C', amount: 60000000, date: '2023-09-10' },
        recentActivity: {
          newHiring: true,
          fundingRound: true,
          productLaunch: true,
          expansionMove: true,
        },
        techStack: ['Go', 'Kubernetes', 'PostgreSQL'],
        engagementScore: 0,
      },
    ],
    fintech: [
      {
        id: 'comp-004',
        name: 'PayFlow Analytics',
        domain: 'payflow.ai',
        industry: 'Fintech',
        size: 220,
        revenue: 8000000,
        funding: { stage: 'Series A', amount: 15000000, date: '2024-02-01' },
        recentActivity: {
          newHiring: true,
          fundingRound: true,
          productLaunch: false,
          expansionMove: true,
        },
        techStack: ['Python', 'FastAPI', 'Redis'],
        engagementScore: 0,
      },
    ],
    realestate: [
      {
        id: 'comp-005',
        name: 'PropTech Innovations',
        domain: 'proptech.com',
        industry: 'Real Estate',
        size: 180,
        revenue: 6000000,
        funding: { stage: 'Series B', amount: 20000000, date: '2024-01-05' },
        recentActivity: {
          newHiring: true,
          fundingRound: true,
          productLaunch: true,
          expansionMove: false,
        },
        techStack: ['React', 'Django', 'PostgreSQL'],
        engagementScore: 0,
      },
    ],
  }

  // Collect companies matching ICP industries
  for (const industry of icp.industry) {
    const industryCompanies = industrySeeds[industry] || []

    // Filter by company size
    const sizeFilters: Record<string, [number, number]> = {
      startup: [1, 50],
      growth: [50, 500],
      enterprise: [500, 50000],
      all: [1, 50000],
    }

    const [minSize, maxSize] = sizeFilters[icp.companySize]

    for (const company of industryCompanies) {
      if (company.size >= minSize && company.size <= maxSize && companies.length < limit) {
        // Calculate engagement score based on recent activity
        let score = 50
        if (company.recentActivity.newHiring) score += 15
        if (company.recentActivity.fundingRound) score += 20
        if (company.recentActivity.productLaunch) score += 10
        if (company.recentActivity.expansionMove) score += 15

        company.engagementScore = Math.min(score, 100)
        companies.push(company)
      }
    }
  }

  return companies.slice(0, limit)
}

/**
 * Identify target personas in discovered companies
 * Simulated - would query LinkedIn, ZoomInfo, Hunter
 */
async function identifyPersonasInCompanies(
  companies: TargetCompany[],
  targetPersonas: TargetPerson[]
): Promise<LeadPerson[]> {
  const leads: LeadPerson[] = []

  // For each company, generate sample personas
  for (const company of companies) {
    for (const persona of targetPersonas) {
      // Simulate finding 1-2 people per persona per company
      const personCount = Math.random() > 0.5 ? 1 : 2

      for (let i = 0; i < personCount; i++) {
        const firstName = generateFirstName()
        const lastName = generateLastName()
        const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${company.domain}`

        // Select a title from persona's title list
        const title = persona.title[Math.floor(Math.random() * persona.title.length)]

        // Calculate fit score based on multiple factors
        let fitScore = 70 // Base score

        // Bonus for recent hiring activity (likely to have budget/authority)
        if (company.recentActivity.newHiring) fitScore += 10

        // Bonus for recent funding (capital to spend)
        if (company.recentActivity.fundingRound) fitScore += 10

        // Bonus for executive personas
        if (persona.seniority === 'executive') fitScore += 15
        if (persona.seniority === 'director') fitScore += 10

        // Penalty if company is very large (harder to reach)
        if (company.size > 5000) fitScore -= 10

        fitScore = Math.min(Math.max(fitScore, 0), 100)

        // Generate personalization hooks
        const hooks = generatePersonalizationHooks(company, persona)

        leads.push({
          firstName,
          lastName,
          email,
          title,
          company,
          role: persona.role,
          linkedinUrl: `https://linkedin.com/in/${firstName.toLowerCase()}-${lastName.toLowerCase()}-${Math.random().toString(36).substr(2, 9)}`,
          fitScore,
          personalizationHooks: hooks,
        })
      }
    }
  }

  return leads
}

/**
 * Generate contextual personalization hooks for outreach
 */
function generatePersonalizationHooks(company: TargetCompany, persona: TargetPerson): string[] {
  const hooks: string[] = []

  // Hook 1: Recent activity
  if (company.recentActivity.fundingRound && company.funding) {
    hooks.push(`${company.name} just raised ${company.funding.stage}`)
  }

  if (company.recentActivity.newHiring) {
    hooks.push(`${company.name} is actively hiring (growth phase)`)
  }

  if (company.recentActivity.productLaunch) {
    hooks.push(`${company.name} just launched new product`)
  }

  // Hook 2: Persona-specific challenges
  hooks.push(
    ...persona.painPoints.map((p) => `You're likely dealing with ${p}`)
  )

  // Hook 3: Tech stack relevance
  if (company.techStack && company.techStack.length > 0) {
    hooks.push(`I noticed you're using ${company.techStack.slice(0, 2).join(' + ')}`)
  }

  // Hook 4: Industry timing
  hooks.push(
    `Most teams in your industry are focused on ${persona.responsibilities[0]} right now`
  )

  return hooks.slice(0, 3) // Return top 3 hooks
}

/**
 * Simulate name generation
 */
function generateFirstName(): string {
  const names = ['Sarah', 'Michael', 'Jennifer', 'David', 'Emily', 'John', 'Lisa', 'Robert', 'Emma', 'James']
  return names[Math.floor(Math.random() * names.length)]
}

function generateLastName(): string {
  const names = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez']
  return names[Math.floor(Math.random() * names.length)]
}

/**
 * Filter and prioritize leads by fit
 */
export function prioritizeLeads(leads: LeadPerson[], maxLeads: number = 500): LeadPerson[] {
  return leads
    .sort((a, b) => {
      // Primary: fit score
      if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore

      // Secondary: company engagement score
      return b.company.engagementScore - a.company.engagementScore
    })
    .slice(0, maxLeads)
}
