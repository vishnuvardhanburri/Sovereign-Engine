/**
 * INTENT ENGINE - Parses natural language goals into actionable campaign parameters
 *
 * Transforms user input like "Get SaaS clients" into:
 * - ICP definition (company size, revenue, industry)
 * - Target roles (CEO, CTO, VP Sales)
 * - Company filters (geography, tech stack, stage)
 * - Messaging angles (pain, value, curiosity)
 * - Sequence strategy (multi-touch, multi-persona)
 */

export interface ICPDefinition {
  industry: string[]
  companySize: 'startup' | 'growth' | 'enterprise' | 'all'
  revenue?: string
  geography?: string[]
  technologies?: string[]
  growthRate?: 'fast' | 'moderate' | 'any'
  fundingStage?: string[]
}

export interface TargetPerson {
  role: string
  title: string[]
  seniority: 'ic' | 'manager' | 'director' | 'executive'
  responsibilities: string[]
  painPoints: string[]
  valueProps: string[]
}

export interface MessagingAngle {
  primary: 'pain' | 'value' | 'curiosity' | 'social_proof'
  secondary?: string[]
  tone: 'professional' | 'friendly' | 'urgent' | 'consultative'
  hooks: string[]
  objectionHandlers: string[]
}

export interface SequenceStrategy {
  multiTouch: boolean
  touchCount: number
  daysBetweenTouches: number
  personas: TargetPerson[]
  anglesPerPersona: MessagingAngle[]
  escalationPath?: string
}

export interface ParsedIntent {
  goal: string
  icp: ICPDefinition
  targetPersonas: TargetPerson[]
  messagingAngles: MessagingAngle[]
  sequenceStrategy: SequenceStrategy
  estimatedVolume: number
  priority: 'immediate' | 'standard' | 'nurture'
  successMetrics: {
    responseRateTarget: number
    conversionRateTarget: number
    engagementMetric: string
  }
}

const ROLE_DEFINITIONS: Record<string, TargetPerson> = {
  ceo: {
    role: 'CEO',
    title: ['CEO', 'Founder', 'Co-Founder', 'Chief Executive Officer'],
    seniority: 'executive',
    responsibilities: ['company strategy', 'board relations', 'revenue targets', 'hiring'],
    painPoints: ['growth bottleneck', 'operational efficiency', 'team scaling', 'investor relations'],
    valueProps: ['revenue growth', 'operational leverage', 'strategic advantage', 'competitive edge'],
  },
  cto: {
    role: 'CTO',
    title: ['CTO', 'VP Engineering', 'Chief Technology Officer', 'Engineering Lead'],
    seniority: 'executive',
    responsibilities: ['tech stack', 'infrastructure', 'team hiring', 'product roadmap'],
    painPoints: ['technical debt', 'engineering velocity', 'reliability', 'team retention'],
    valueProps: ['faster deployment', 'better performance', 'reduced cost', 'developer satisfaction'],
  },
  vpsales: {
    role: 'VP Sales',
    title: ['VP Sales', 'Sales Director', 'VP Revenue', 'Head of Sales'],
    seniority: 'director',
    responsibilities: ['sales strategy', 'team management', 'quota attainment', 'customer acquisition'],
    painPoints: ['pipeline', 'sales cycle length', 'win rate', 'team productivity'],
    valueProps: ['more pipeline', 'shorter cycles', 'higher wins', 'better forecasting'],
  },
  marketing: {
    role: 'CMO',
    title: ['CMO', 'VP Marketing', 'Head of Marketing', 'Director of Marketing'],
    seniority: 'director',
    responsibilities: ['demand gen', 'brand', 'analytics', 'content'],
    painPoints: ['lead quality', 'cost per lead', 'brand awareness', 'attribution'],
    valueProps: ['better leads', 'lower CAC', 'more visibility', 'clearer ROI'],
  },
}

const ANGLE_TEMPLATES: Record<string, MessagingAngle> = {
  pain: {
    primary: 'pain',
    tone: 'consultative',
    hooks: [
      "I've noticed most teams in your space struggle with",
      'Research shows companies like yours often face',
      'We work with 20+ similar companies dealing with',
    ],
    objectionHandlers: [
      'Not your problem? Maybe for this year, but ahead of that...',
      'I get it – low priority right now. Could work better when...',
    ],
  },
  value: {
    primary: 'value',
    tone: 'professional',
    hooks: [
      'Quick opportunity we think could drive',
      'Based on your recent',
      'We just helped a similar company achieve',
    ],
    objectionHandlers: [
      "Fair point. Here's what most teams miss though:",
      'Common concern. The angle that shifts minds usually involves...',
    ],
  },
  curiosity: {
    primary: 'curiosity',
    tone: 'friendly',
    hooks: [
      'Quick question about',
      "Curious if you've seen",
      "One thing we've noticed across your industry",
    ],
    objectionHandlers: [
      'Totally fair. The insight that tends to resonate is...',
      'Makes sense. Different angle that lands better...',
    ],
  },
  social_proof: {
    primary: 'social_proof',
    tone: 'professional',
    hooks: [
      'Noticed you work alongside',
      'Since you integrated with',
      'Being in the same ecosystem as',
    ],
    objectionHandlers: [
      'Fair. Most have that concern initially. The way it actually works...',
    ],
  },
}

/**
 * Parse natural language intent into structured campaign parameters
 */
export async function parseIntent(userGoal: string): Promise<ParsedIntent> {
  const goal = userGoal.toLowerCase()

  // Detect industry/ICP from goal
  const icp = detectICP(goal)

  // Detect target personas
  const targetPersonas = detectPersonas(goal)

  // Define messaging angles
  const messagingAngles = generateAngles(targetPersonas, icp)

  // Create sequence strategy
  const sequenceStrategy: SequenceStrategy = {
    multiTouch: true,
    touchCount: targetPersonas.length > 1 ? 3 : 2, // Multi-persona = more touches
    daysBetweenTouches: 3,
    personas: targetPersonas,
    anglesPerPersona: messagingAngles,
    escalationPath: targetPersonas.length > 1 ? 'ic_to_manager_to_executive' : undefined,
  }

  // Estimate volume
  const estimatedVolume = estimateLeadVolume(icp, targetPersonas)

  return {
    goal: userGoal,
    icp,
    targetPersonas,
    messagingAngles,
    sequenceStrategy,
    estimatedVolume,
    priority: detectPriority(goal),
    successMetrics: {
      responseRateTarget: 0.05, // 5% response rate baseline
      conversionRateTarget: 0.01, // 1% conversion rate baseline
      engagementMetric: 'positive_reply_rate',
    },
  }
}

/**
 * Detect ICP from natural language goal
 */
function detectICP(goal: string): ICPDefinition {
  const icp: ICPDefinition = {
    industry: [],
    companySize: 'all',
    geography: [],
  }

  // Industry detection
  const industryPatterns: Record<string, string[]> = {
    saas: ['saas', 'software', 'b2b', 'cloud'],
    fintech: ['fintech', 'finance', 'payments', 'banking'],
    realestate: ['real estate', 'realty', 'property', 'realtor'],
    ecommerce: ['ecommerce', 'shopify', 'seller', 'store'],
    healthcare: ['healthcare', 'medical', 'hospital', 'clinic'],
    education: ['education', 'school', 'university', 'edtech'],
    agency: ['agency', 'creative', 'marketing agency', 'digital'],
  }

  for (const [industry, patterns] of Object.entries(industryPatterns)) {
    if (patterns.some((p) => goal.includes(p))) {
      icp.industry.push(industry)
    }
  }

  // Company size detection
  if (goal.includes('startup') || goal.includes('early')) icp.companySize = 'startup'
  else if (goal.includes('growth') || goal.includes('mid')) icp.companySize = 'growth'
  else if (goal.includes('enterprise') || goal.includes('large')) icp.companySize = 'enterprise'

  // Geography detection
  const geoPatterns: Record<string, string[]> = {
    us: ['us', 'united states', 'usa', 'american'],
    uk: ['uk', 'united kingdom', 'london'],
    eu: ['europe', 'european', 'emea'],
    asia: ['asia', 'apac', 'singapore', 'tokyo'],
  }

  for (const [region, patterns] of Object.entries(geoPatterns)) {
    if (patterns.some((p) => goal.includes(p))) {
      icp.geography?.push(region)
    }
  }

  if (icp.industry.length === 0) icp.industry = ['saas'] // Default
  if (!icp.geography || icp.geography.length === 0) icp.geography = ['us'] // Default

  return icp
}

/**
 * Detect target personas from goal
 */
function detectPersonas(goal: string): TargetPerson[] {
  const personas: TargetPerson[] = []

  // Check for specific role mentions
  const roleMatches: Record<string, string> = {
    ceo: goal.includes('ceo') || goal.includes('founder') ? 'ceo' : '',
    cto: goal.includes('cto') || goal.includes('engineering') ? 'cto' : '',
    vpsales: goal.includes('sales') || goal.includes('vp sales') ? 'vpsales' : '',
    marketing: goal.includes('marketing') || goal.includes('cmo') ? 'marketing' : '',
  }

  // If no specific roles, infer from industry
  if (Object.values(roleMatches).every((v) => !v)) {
    // Default to decision-maker personas
    personas.push(ROLE_DEFINITIONS.ceo, ROLE_DEFINITIONS.vpsales)
  } else {
    for (const [, roleKey] of Object.entries(roleMatches)) {
      if (roleKey && ROLE_DEFINITIONS[roleKey]) {
        personas.push(ROLE_DEFINITIONS[roleKey])
      }
    }
  }

  return personas.length > 0 ? personas : [ROLE_DEFINITIONS.ceo, ROLE_DEFINITIONS.vpsales]
}

/**
 * Generate messaging angles for target personas
 */
function generateAngles(personas: TargetPerson[], _icp: ICPDefinition): MessagingAngle[] {
  const angles: MessagingAngle[] = []

  // Different angle for each persona
  const angleKeys = Object.keys(ANGLE_TEMPLATES)

  personas.forEach((persona, idx) => {
    const angleKey = angleKeys[idx % angleKeys.length]
    const template = ANGLE_TEMPLATES[angleKey]

    // Customize based on persona
    let tone = template.tone
    if (persona.seniority === 'executive') {
      tone = 'consultative' // C-level prefers consultative
    }

    angles.push({
      primary: template.primary,
      tone,
      hooks: template.hooks.map((h) => h.replace(/your space/, persona.role.toLowerCase())),
      objectionHandlers: template.objectionHandlers,
    })
  })

  return angles
}

/**
 * Estimate addressable market size
 */
function estimateLeadVolume(icp: ICPDefinition, personas: TargetPerson[]): number {
  // Rough market sizing
  const baseVolume: Record<string, number> = {
    saas: 50000,
    fintech: 20000,
    realestate: 30000,
    ecommerce: 40000,
    healthcare: 25000,
    education: 15000,
    agency: 35000,
  }

  let volume = baseVolume[icp.industry[0]] ?? 30000

  // Adjust by company size
  const sizeMultipliers: Record<string, number> = {
    startup: 0.3,
    growth: 0.5,
    enterprise: 0.2,
    all: 1.0,
  }

  volume *= sizeMultipliers[icp.companySize]

  // Adjust by number of personas (multi-persona = fewer addressable leads)
  volume *= 1 / personas.length

  // Adjust by geography
  const geoMultipliers: Record<string, number> = {
    us: 1.0,
    uk: 0.3,
    eu: 0.4,
    asia: 0.35,
  }

  if (icp.geography && icp.geography.length > 0) {
    const geoMultiplier = icp.geography.reduce((a, g) => a + (geoMultipliers[g] ?? 0.5), 0) / icp.geography.length
    volume *= geoMultiplier
  }

  return Math.round(volume)
}

/**
 * Detect campaign priority from goal
 */
function detectPriority(goal: string): 'immediate' | 'standard' | 'nurture' {
  if (goal.includes('urgent') || goal.includes('asap') || goal.includes('immediate'))
    return 'immediate'
  if (goal.includes('test') || goal.includes('nurture') || goal.includes('gradual'))
    return 'nurture'
  return 'standard'
}
