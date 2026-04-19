import { generateSubjectIdeas } from '@/lib/integrations/openrouter'

export async function suggestSubjectLines(input: {
  offer: string
  company?: string | null
  angle: 'pattern' | 'pain' | 'authority'
}) {
  return generateSubjectIdeas(input)
}
