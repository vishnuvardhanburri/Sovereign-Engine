export async function generateIntroLine(input: {
  company?: string | null
  role?: string | null
  offer?: string | null
  pain?: string | null
}) {
  return `saw your work at ${input.company || 'your team'}`
}

export async function classifyReplyWithAi(text: string) {
  const lowered = text.toLowerCase()
  if (/\binterested\b|\blet'?s talk\b|\bschedule\b|\bbook\b/.test(lowered)) {
    return 'interested' as const
  }
  if (/\bnot interested\b|\bremove me\b|\bstop\b|\bunsubscribe\b/.test(lowered)) {
    return 'not_interested' as const
  }
  if (/\bout of office\b|\bvacation\b|\booo\b/.test(lowered)) {
    return 'ooo' as const
  }
  return 'not_interested' as const
}

export async function generateSubjectIdeas(input: {
  offer: string
  company?: string | null
  angle: 'pattern' | 'pain' | 'authority'
}) {
  const company = input.company || 'your team'
  return [
    `Quick idea for ${company}`,
    `${company} question`,
    `Regarding ${company} growth`,
  ]
}
