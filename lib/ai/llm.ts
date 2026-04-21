import { extractIntent } from './intent'
import { generateEmailFromTemplate, generateIntroLine, generateSubjectLine } from './generator'
import type { Contact, SequenceStep } from '@/lib/db/types'

export interface LLMTaskResult {
  task: string
  result: Record<string, unknown>
  confidence: number
  source: 'rule' | 'template'
}

function clampConfidence(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export async function runLLM(
  task: string,
  context: Record<string, unknown>
): Promise<LLMTaskResult> {
  switch (task) {
    case 'reply_classification': {
      const text = String(context.text ?? context.body ?? '')
      const intent = extractIntent(text)
      return {
        task,
        result: { intent: intent.intent },
        confidence: intent.confidence,
        source: 'rule',
      }
    }
    case 'subject_generation': {
      const contact = context.contact as Contact
      const angle = (context.angle as 'pattern' | 'pain' | 'authority') ?? 'pattern'
      const output = generateSubjectLine({ contact, angle })
      return {
        task,
        result: output.result,
        confidence: 0.86,
        source: output.source,
      }
    }
    case 'personalization_line': {
      const contact = context.contact as Contact
      const output = generateIntroLine({ contact })
      return {
        task,
        result: output.result,
        confidence: 0.84,
        source: output.source,
      }
    }
    case 'email_generation': {
      const contact = context.contact as Contact
      const step = context.step as Pick<SequenceStep, 'subject' | 'body'>
      const output = generateEmailFromTemplate({ contact, step })
      return {
        task,
        result: output.result,
        confidence: 0.82,
        source: output.source,
      }
    }
    default:
      return {
        task,
        result: {},
        confidence: clampConfidence(Number(context.confidence ?? 0.2)),
        source: 'rule',
      }
  }
}
