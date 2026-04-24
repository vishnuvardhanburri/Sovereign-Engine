export interface IntentResult {
  intent: string
  confidence: number
}

const RULES: Array<{ intent: string; patterns: RegExp[]; confidence: number }> = [
  {
    intent: 'interested',
    patterns: [/\binterested\b/i, /\blet[’']?s talk\b/i, /\bschedule\b/i, /\bbook\b/i],
    confidence: 0.96,
  },
  {
    intent: 'not_interested',
    patterns: [/\bnot interested\b/i, /\bremove me\b/i, /\bstop\b/i, /\bunsubscribe\b/i],
    confidence: 0.98,
  },
  {
    intent: 'ooo',
    patterns: [/\bout of office\b/i, /\bvacation\b/i, /\bback on\b/i],
    confidence: 0.92,
  },
  {
    intent: 'pricing',
    patterns: [/\bprice\b/i, /\bpricing\b/i, /\bcost\b/i, /\brate\b/i],
    confidence: 0.9,
  },
]

export function extractIntent(input: string): IntentResult {
  const text = input.trim()
  if (!text) {
    return { intent: 'unknown', confidence: 0 }
  }

  const matched = RULES.find((rule) => rule.patterns.some((pattern) => pattern.test(text)))
  if (matched) {
    return { intent: matched.intent, confidence: matched.confidence }
  }

  return { intent: 'unknown', confidence: 0.35 }
}
