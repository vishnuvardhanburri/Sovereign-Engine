import type { Contact, SequenceStep } from '@/lib/db/types'
import { selectPattern } from '@/lib/learning/selector'
import type { CopilotSystemContext } from '@/lib/ai/system-context'
import type { CopilotDecisionOutput } from '@/lib/ai/decision-engine'

export interface DeterministicGenerationResult {
  task: string
  result: Record<string, unknown>
  source: 'rule' | 'template'
}

const GREETINGS = ['Hi', 'Hello', 'Hey']

export function pickDeterministic<T>(items: readonly T[], seed: string): T {
  if (items.length === 0) {
    throw new Error('pickDeterministic requires at least one item')
  }

  let hash = 0
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }

  return items[hash % items.length]
}

function render(template: string, contact: Contact): string {
  const firstName = contact.name?.split(' ')[0]?.trim() || 'there'
  return template
    .replaceAll('{{name}}', firstName)
    .replaceAll('{{company}}', contact.company || 'your team')
    .replaceAll('{{title}}', contact.title || 'team')
}

export function generateSubjectLine(input: {
  contact: Contact
  angle?: 'pattern' | 'pain' | 'authority'
}): DeterministicGenerationResult {
  const bank = [
    'Quick idea for {{company}}',
    '{{name}}, quick question',
    'Regarding {{company}} growth',
  ]
  const selected = pickDeterministic(bank, `${input.contact.email}:${input.angle ?? 'pattern'}`)
  return {
    task: 'subject_generation',
    result: { subject: render(selected, input.contact) },
    source: 'template',
  }
}

export async function generateSubjectLineLearned(input: {
  contact: Contact
  angle?: 'pattern' | 'pain' | 'authority'
}): Promise<DeterministicGenerationResult> {
  const chosen = await selectPattern({ type: 'subject', avoidUsedWithinMinutes: 30 })
  if (!chosen) {
    return generateSubjectLine(input)
  }
  return {
    task: 'subject_generation',
    result: { subject: render(chosen.content, input.contact), pattern_id: chosen.id },
    source: chosen.status === 'testing' ? 'rule' : 'template',
  }
}

export function generateIntroLine(input: {
  contact: Contact
  company?: string | null
  role?: string | null
  offer?: string | null
  pain?: string | null
}): DeterministicGenerationResult {
  const options = [
    'saw your work at {{company}}',
    'noticed what you are building at {{company}}',
    'was looking at {{company}} and thought of you',
  ]
  const selected = pickDeterministic(options, `${input.contact.email}:${input.company ?? ''}`)
  return {
    task: 'personalization_line',
    result: { intro: render(selected, input.contact) },
    source: 'template',
  }
}

export async function generateIntroLineLearned(input: {
  contact: Contact
  company?: string | null
  role?: string | null
  offer?: string | null
  pain?: string | null
}): Promise<DeterministicGenerationResult> {
  const chosen = await selectPattern({ type: 'intro', avoidUsedWithinMinutes: 30 })
  if (!chosen) {
    return generateIntroLine(input)
  }
  return {
    task: 'personalization_line',
    result: { intro: render(chosen.content, input.contact), pattern_id: chosen.id },
    source: chosen.status === 'testing' ? 'rule' : 'template',
  }
}

export function generateEmailFromTemplate(input: {
  contact: Contact
  step: Pick<SequenceStep, 'subject' | 'body'>
}): DeterministicGenerationResult {
  const greeting = pickDeterministic(GREETINGS, input.contact.email)
  const intro = input.contact.company
    ? `saw your work at ${input.contact.company}`
    : 'reaching out with a quick idea'
  const text = [
    `${greeting} ${input.contact.name?.split(' ')[0] ?? 'there'},`,
    intro,
    input.step.body.replaceAll('{{name}}', input.contact.name?.split(' ')[0] ?? 'there').replaceAll('{{company}}', input.contact.company || 'your team'),
  ]
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5)
    .join('\n')

  return {
    task: 'email_generation',
    result: {
      subject: render(input.step.subject, input.contact),
      text,
    },
    source: 'template',
  }
}

export async function generateEmailFromTemplateLearned(input: {
  contact: Contact
  step: Pick<SequenceStep, 'subject' | 'body'>
}): Promise<DeterministicGenerationResult> {
  const [subject, intro] = await Promise.all([
    generateSubjectLineLearned({ contact: input.contact, angle: 'pattern' }),
    generateIntroLineLearned({ contact: input.contact, company: input.contact.company }),
  ])

  const greeting = pickDeterministic(GREETINGS, input.contact.email)
  const introLine = String(intro.result.intro ?? 'reaching out with a quick idea')
  const text = [
    `${greeting} ${input.contact.name?.split(' ')[0] ?? 'there'},`,
    introLine,
    input.step.body
      .replaceAll('{{name}}', input.contact.name?.split(' ')[0] ?? 'there')
      .replaceAll('{{company}}', input.contact.company || 'your team'),
  ]
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5)
    .join('\n')

  return {
    task: 'email_generation',
    result: {
      subject: String(subject.result.subject ?? render(input.step.subject, input.contact)),
      text,
      pattern_ids: [subject.result.pattern_id, intro.result.pattern_id].filter(Boolean),
    },
    source: 'template',
  }
}

/**
 * AUTONOMOUS COPILOT RESPONSE (SYSTEM-AWARE, DETERMINISTIC)
 *
 * This is not a chatbot: it formats grounded system data into a tight operator brief.
 *
 * Response format:
 * 1. Current state
 * 2. Insight
 * 3. Action
 */
export function generateCopilotBrief(input: {
  context: CopilotSystemContext
  decision: CopilotDecisionOutput
}): DeterministicGenerationResult {
  const { context, decision } = input

  const stateLine = [
    `System: ${context.systemStatus} (${context.riskLevel} risk)`,
    `24h sent=${context.performance.last24h.sent}`,
    `reply=${Math.round(context.performance.last24h.replyRate * 10000) / 100}%`,
    `bounce=${Math.round(context.performance.last24h.bounceRate * 10000) / 100}%`,
    `queue pending=${context.queue.pending}, retry=${context.queue.retry}`,
  ].join(' · ')

  const topIssue = decision.diagnoses[0]
  const insightLine = topIssue
    ? `${topIssue.issue}. ${topIssue.cause}`
    : 'No anomalies detected from current system signals.'

  const actionLines = decision.diagnoses
    .flatMap((d) => d.recommendedActions)
    .slice(0, 3)
    .map((a) => `- ${a.title}: ${a.detail}`)

  const text = [
    `1) Current state`,
    stateLine,
    ``,
    `2) Insight`,
    insightLine,
    ``,
    `3) Action`,
    actionLines.length ? actionLines.join('\n') : '- No action recommended right now.',
  ].join('\n')

  return {
    task: 'copilot_brief',
    result: {
      text,
      systemStatus: context.systemStatus,
      riskLevel: context.riskLevel,
      headline: decision.summary.headline,
    },
    source: 'rule',
  }
}
