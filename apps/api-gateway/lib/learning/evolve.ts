import { upsertPattern, type PatternRecord, type PatternType } from '@/lib/ai/pattern-memory'

function mutateWords(text: string): string {
  const swaps: Array<[RegExp, string]> = [
    [/\bquick\b/gi, 'fast'],
    [/\bidea\b/gi, 'thought'],
    [/\bgrowth\b/gi, 'pipeline'],
    [/\bquestion\b/gi, 'ask'],
    [/\bregarding\b/gi, 'about'],
  ]

  let out = text
  for (const [pattern, replacement] of swaps) {
    if (pattern.test(out)) {
      out = out.replace(pattern, replacement)
      break
    }
  }
  return out
}

function combine(a: string, b: string): string {
  const left = a.trim().replace(/\s+/g, ' ')
  const right = b.trim().replace(/\s+/g, ' ')
  if (!left) return right
  if (!right) return left
  if (left.toLowerCase() === right.toLowerCase()) return left
  // Keep it short; take first clause from one and CTA from another.
  const leftPart = left.split(/[.?!]/)[0] ?? left
  const rightPart = right.split(/[.?!]/)[0] ?? right
  return `${leftPart.trim()} — ${rightPart.trim()}`
}

export async function evolvePatterns(input: {
  type: PatternType
  top: PatternRecord[]
  maxVariants?: number
}): Promise<PatternRecord[]> {
  const max = Math.max(1, Math.min(10, input.maxVariants ?? 5))
  const created: PatternRecord[] = []

  const base = input.top.slice(0, 3)
  for (let i = 0; i < base.length && created.length < max; i += 1) {
    for (let j = i + 1; j < base.length && created.length < max; j += 1) {
      const combined = combine(base[i]!.content, base[j]!.content)
      const mutated = mutateWords(combined)
      const record = await upsertPattern({ type: input.type, content: mutated, status: 'testing' })
      created.push(record)
    }
  }

  // Ensure at least one mutation of the best performer.
  if (created.length === 0 && base[0]) {
    const record = await upsertPattern({ type: input.type, content: mutateWords(base[0].content), status: 'testing' })
    created.push(record)
  }

  return created
}

