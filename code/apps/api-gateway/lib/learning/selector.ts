import { loadPatternStore, markPatternUsed, type PatternRecord, type PatternType } from '@/lib/ai/pattern-memory'

export interface SelectPatternOptions {
  type: PatternType
  minScore?: number
  avoidUsedWithinMinutes?: number
}

function minutesAgo(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY
  const ms = Date.now() - new Date(iso).getTime()
  return ms / 60000
}

function pickRotatingTop(patterns: PatternRecord[], rotateTop = 3): PatternRecord | null {
  if (patterns.length === 0) return null
  const top = patterns.slice(0, Math.min(rotateTop, patterns.length))
  const index = Math.abs((Date.now() / 60000) | 0) % top.length
  return top[index] ?? top[0] ?? null
}

export async function selectPattern(options: SelectPatternOptions): Promise<PatternRecord | null> {
  const store = await loadPatternStore()
  const avoidMinutes = options.avoidUsedWithinMinutes ?? 60
  const minScore = options.minScore ?? -0.05

  const candidates = store.patterns
    .filter((p) => p.type === options.type)
    .filter((p) => p.status !== 'disabled')
    .filter((p) => minutesAgo(p.last_used_at) >= avoidMinutes)
    .sort((a, b) => (b.score - a.score) || (b.reply_rate - a.reply_rate) || (b.open_rate - a.open_rate))

  const chosen = pickRotatingTop(candidates, 3)
  if (!chosen) {
    const fallback = store.patterns.find((p) => p.type === options.type && p.status !== 'disabled') ?? null
    if (!fallback) return null
    await markPatternUsed(fallback.id)
    return fallback
  }

  if (chosen.score < minScore) {
    const testing = candidates.find((p) => p.status === 'testing') ?? null
    if (testing) {
      await markPatternUsed(testing.id)
      return testing
    }
  }

  await markPatternUsed(chosen.id)
  return chosen
}

