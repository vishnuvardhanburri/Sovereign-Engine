import type { PatternRecord } from '@/lib/ai/pattern-memory'

export function scorePattern(input: Pick<PatternRecord, 'reply_rate' | 'open_rate' | 'bounce_rate'>): number {
  return (input.reply_rate * 0.6) + (input.open_rate * 0.3) - (input.bounce_rate * 0.5)
}

