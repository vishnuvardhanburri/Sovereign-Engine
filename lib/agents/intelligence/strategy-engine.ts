/**
 * STRATEGY ENGINE - Determines optimal campaign approach
 *
 * Decides:
 * - Which persona to target first (CEO vs Marketing vs Sales)
 * - Which messaging angle (pain vs value vs curiosity)
 * - Which sequence path (short vs extended multi-touch)
 * - Tone and tone variations per touch
 * - Escalation rules and conditions
 */

import type { TargetPerson, MessagingAngle, SequenceStrategy } from './intent-engine'
import type { LeadPerson } from './target-discovery'

export interface StrategyDecision {
  primaryPersona: TargetPerson
  secondaryPersonas: TargetPerson[]
  primaryAngle: MessagingAngle
  angleSequence: MessagingAngle[] // Ordered by touch
  touchSequence: TouchStrategy[]
  escalationRules: EscalationRule[]
  segmentationApproach: 'persona_first' | 'company_first' | 'mixed'
  expectedOutcomes: {
    responseRateTarget: number
    timeToFirstReply: number
    conversionRate: number
  }
}

export interface TouchStrategy {
  touchNumber: number
  persona: TargetPerson
  angle: MessagingAngle
  messageType: 'initial' | 'follow_up' | 'value_add' | 'urgency' | 'last_touch'
  daysBetweenPrevious: number
  tone: string
  expectedOpenRate: number
  expectedClickRate: number
}

export interface EscalationRule {
  trigger: 'no_open' | 'no_reply' | 'viewed_multiple' | 'engaged' | 'bounced'
  condition: string
  action: 'move_to_next_persona' | 'escalate_angle' | 'pause' | 'stop_sequence'
  newPersona?: TargetPerson
  newAngle?: MessagingAngle
}

/**
 * Generate optimal strategy for campaign
 */
export function generateStrategy(
  targetPersonas: TargetPerson[],
  messagingAngles: MessagingAngle[],
  sequenceStrategy: SequenceStrategy,
  leads: LeadPerson[]
): StrategyDecision {
  // Determine primary persona (highest impact)
  const primaryPersona = determinePrimaryPersona(targetPersonas, leads)

  // Determine secondary personas for escalation
  const secondaryPersonas = targetPersonas.filter((p) => p.role !== primaryPersona.role)

  // Determine primary angle (best for primary persona)
  const primaryAngle = determinePrimaryAngle(messagingAngles, primaryPersona)

  // Build touch sequence
  const touchSequence = buildTouchSequence(
    targetPersonas,
    messagingAngles,
    sequenceStrategy.touchCount
  )

  // Define escalation rules
  const escalationRules = defineEscalationRules(primaryPersona, secondaryPersonas, messagingAngles)

  // Determine segmentation approach
  const segmentationApproach = determineSegmentationApproach(targetPersonas, leads)

  // Calculate expected outcomes
  const expectedOutcomes = calculateExpectedOutcomes(touchSequence, messagingAngles)

  return {
    primaryPersona,
    secondaryPersonas,
    primaryAngle,
    angleSequence: messagingAngles,
    touchSequence,
    escalationRules,
    segmentationApproach,
    expectedOutcomes,
  }
}

/**
 * Determine which persona is most likely to convert
 * Factors: seniority, budget authority, pain point urgency
 */
function determinePrimaryPersona(
  personas: TargetPerson[],
  leads: LeadPerson[]
): TargetPerson {
  // Score each persona type
  const personaScores: Record<string, number> = {}

  for (const persona of personas) {
    let score = 0

    // C-level has highest conversion typically
    if (persona.seniority === 'executive') score += 40
    else if (persona.seniority === 'director') score += 30
    else if (persona.seniority === 'manager') score += 20
    else score += 10

    // VP Sales is often easiest to reach and move fast
    if (persona.role === 'VP Sales') score += 15

    // Count how many leads we have for this persona (data signal)
    const personaLeadCount = leads.filter((l) => l.role === persona.role).length
    score += Math.min(personaLeadCount, 10) // Cap at 10

    personaScores[persona.role] = score
  }

  // Return persona with highest score
  const topPersona = Object.entries(personaScores)
    .sort(([, a], [, b]) => b - a)[0][0]

  return personas.find((p) => p.role === topPersona) || personas[0]
}

/**
 * Determine best messaging angle for persona
 */
function determinePrimaryAngle(angles: MessagingAngle[], persona: TargetPerson): MessagingAngle {
  // Executives respond better to value/ROI
  if (persona.seniority === 'executive') {
    return angles.find((a) => a.primary === 'value') || angles[0]
  }

  // Directors respond well to pain/problem focus
  if (persona.seniority === 'director') {
    return angles.find((a) => a.primary === 'pain') || angles[0]
  }

  // Default to curiosity for ICs (lowest friction)
  return angles.find((a) => a.primary === 'curiosity') || angles[0]
}

/**
 * Build optimal touch sequence
 * Multi-touch with angle variation keeps campaign fresh
 */
function buildTouchSequence(
  personas: TargetPerson[],
  angles: MessagingAngle[],
  totalTouches: number
): TouchStrategy[] {
  const sequence: TouchStrategy[] = []

  // Touch 1: Initial outreach to primary persona with primary angle
  sequence.push({
    touchNumber: 1,
    persona: personas[0],
    angle: angles[0],
    messageType: 'initial',
    daysBetweenPrevious: 0,
    tone: angles[0].tone,
    expectedOpenRate: 0.35, // 35% open rate for cold emails
    expectedClickRate: 0.08, // 8% click rate
  })

  // Touches 2+: Vary angle and add value
  if (totalTouches > 1) {
    sequence.push({
      touchNumber: 2,
      persona: personas[0],
      angle: angles[1] || angles[0],
      messageType: 'follow_up',
      daysBetweenPrevious: 3,
      tone: 'friendly',
      expectedOpenRate: 0.25, // 25% open rate for follow-up
      expectedClickRate: 0.06,
    })
  }

  if (totalTouches > 2) {
    // Try different persona if available
    const secondPersona = personas.length > 1 ? personas[1] : personas[0]
    sequence.push({
      touchNumber: 3,
      persona: secondPersona,
      angle: angles[2] || angles[1] || angles[0],
      messageType: 'value_add',
      daysBetweenPrevious: 3,
      tone: 'consultative',
      expectedOpenRate: 0.2, // 20% open rate for personalized value-add
      expectedClickRate: 0.05,
    })
  }

  if (totalTouches > 3) {
    sequence.push({
      touchNumber: 4,
      persona: personas[0],
      angle: angles[0],
      messageType: 'urgency',
      daysBetweenPrevious: 4,
      tone: 'professional',
      expectedOpenRate: 0.15, // 15% open rate for urgency touch
      expectedClickRate: 0.04,
    })
  }

  if (totalTouches > 4) {
    sequence.push({
      touchNumber: 5,
      persona: personas[0],
      angle: angles[3] || angles[0],
      messageType: 'last_touch',
      daysBetweenPrevious: 5,
      tone: 'professional',
      expectedOpenRate: 0.1, // 10% open rate for last touch
      expectedClickRate: 0.02,
    })
  }

  return sequence.slice(0, totalTouches)
}

/**
 * Define rules for when to escalate, pause, or change strategy
 */
function defineEscalationRules(
  primaryPersona: TargetPerson,
  secondaryPersonas: TargetPerson[],
  angles: MessagingAngle[]
): EscalationRule[] {
  const rules: EscalationRule[] = []

  // If no opens after 2 touches, switch angle
  rules.push({
    trigger: 'no_open',
    condition: 'after_touch_2_and_no_opens',
    action: 'escalate_angle',
    newAngle: angles[1] || angles[0],
  })

  // If multiple views but no reply, escalate to new persona
  rules.push({
    trigger: 'viewed_multiple',
    condition: 'after_3_views_and_no_reply',
    action: 'move_to_next_persona',
    newPersona: secondaryPersonas[0],
  })

  // If engaged (clicked, opened multiple times), send value-add
  rules.push({
    trigger: 'engaged',
    condition: 'multiple_opens_or_clicks',
    action: 'move_to_next_persona', // Move up org to decision maker
    newPersona: primaryPersona.seniority === 'ic' ? secondaryPersonas[0] : primaryPersona,
  })

  // If bounced, stop
  rules.push({
    trigger: 'bounced',
    condition: 'hard_bounce',
    action: 'stop_sequence',
  })

  // If no reply after 3 touches, pause (retry later)
  rules.push({
    trigger: 'no_reply',
    condition: 'after_touch_3_and_no_reply',
    action: 'pause',
  })

  return rules
}

/**
 * Determine how to segment and approach leads
 */
function determineSegmentationApproach(
  personas: TargetPerson[],
  leads: LeadPerson[]
): 'persona_first' | 'company_first' | 'mixed' {
  // If we have multiple personas, start with persona approach
  if (personas.length > 1) {
    return 'persona_first'
  }

  // If we have very high-value leads, focus on company accounts
  const highValueLeads = leads.filter((l) => l.fitScore > 85)
  if (highValueLeads.length > 0 && highValueLeads.length < leads.length * 0.2) {
    return 'company_first'
  }

  return 'mixed'
}

/**
 * Calculate expected campaign outcomes
 */
function calculateExpectedOutcomes(
  touches: TouchStrategy[],
  _angles: MessagingAngle[]
): { responseRateTarget: number; timeToFirstReply: number; conversionRate: number } {
  // Calculate blended response rate across all touches
  const totalOpenRate = touches.reduce((a, t) => a + t.expectedOpenRate, 0) / touches.length
  const avgClickRate = touches.reduce((a, t) => a + t.expectedClickRate, 0) / touches.length

  // Response rate ≈ click rate * conversion rate
  const responseRateTarget = Math.min(totalOpenRate * 0.15, 0.05) // 5% response rate baseline

  // Most replies come within 24 hours of engagement
  const timeToFirstReply = 24 // hours

  // Conversion (reply to booking) typically 10-20% of responses
  const conversionRate = responseRateTarget * 0.15

  return {
    responseRateTarget,
    timeToFirstReply,
    conversionRate,
  }
}

/**
 * Apply strategy decision to leads
 * Returns leads segmented by strategy
 */
export function applyStrategyToLeads(
  leads: LeadPerson[],
  strategy: StrategyDecision
): { [key: string]: LeadPerson[] } {
  const segmented: { [key: string]: LeadPerson[] } = {
    primary_persona: [],
    secondary_personas: [],
    wait_list: [],
  }

  for (const lead of leads) {
    if (lead.role === strategy.primaryPersona.role) {
      segmented.primary_persona.push(lead)
    } else if (strategy.secondaryPersonas.some((p) => p.role === lead.role)) {
      segmented.secondary_personas.push(lead)
    } else {
      segmented.wait_list.push(lead)
    }
  }

  return segmented
}
