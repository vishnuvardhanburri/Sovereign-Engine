export type ReplyClassification = 'interested' | 'not_interested' | 'ooa' | 'unsure'

export async function classifyReply(text: string): Promise<ReplyClassification> {
  const normalized = text.toLowerCase()

  if (normalized.includes("let's talk") || normalized.includes('interested') || normalized.includes('book')) {
    return 'interested'
  }

  if (normalized.includes('not interested') || normalized.includes('unsubscribe') || normalized.includes('stop')) {
    return 'not_interested'
  }

  if (normalized.includes('out of office') || normalized.includes('ooO') || normalized.includes('travel')) {
    return 'ooa'
  }

  return 'unsure'
}
