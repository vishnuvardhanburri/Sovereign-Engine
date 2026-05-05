import type { ReplyClassification } from '@/lib/agents/inbox/reply-classifier'

export interface ObjectionStrategy {
  tone: 'firm' | 'empathetic' | 'informative'
  nextStep: string
}

export async function buildObjectionStrategy(classification: ReplyClassification) {
  if (classification === 'interested') {
    return {
      tone: 'informative' as const,
      nextStep: 'book_call',
    }
  }

  if (classification === 'not_interested') {
    return {
      tone: 'empathetic' as const,
      nextStep: 'close_loop',
    }
  }

  if (classification === 'ooa') {
    return {
      tone: 'empathetic' as const,
      nextStep: 'follow_up_after_ooa',
    }
  }

  return {
    tone: 'informative' as const,
    nextStep: 'clarify_interest',
  }
}
