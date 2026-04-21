import { disablePattern, loadPatternStore, savePatternStore, type PatternRecord } from '@/lib/ai/pattern-memory'
import { scorePattern } from '@/lib/learning/scoring'

export type FeedbackEventType = 'EMAIL_OPENED' | 'EMAIL_REPLIED' | 'EMAIL_BOUNCED'

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function derivedCounts(pattern: PatternRecord): { opens: number; replies: number; bounces: number } {
  const usage = Math.max(0, pattern.usage_count)
  return {
    opens: Math.round(pattern.open_rate * usage),
    replies: Math.round(pattern.reply_rate * usage),
    bounces: Math.round(pattern.bounce_rate * usage),
  }
}

function updateRatesFromCounts(pattern: PatternRecord, counts: { opens: number; replies: number; bounces: number }): void {
  const usage = Math.max(1, pattern.usage_count)
  pattern.open_rate = clamp01(counts.opens / usage)
  pattern.reply_rate = clamp01(counts.replies / usage)
  pattern.bounce_rate = clamp01(counts.bounces / usage)
  pattern.score = scorePattern(pattern)
}

export interface FeedbackIngestResult {
  updated: number
  disabled: number
}

export async function ingestPatternFeedback(input: {
  eventType: FeedbackEventType
  patternIds: string[]
  replyThresholdDisable?: number
}): Promise<FeedbackIngestResult> {
  const unique = Array.from(new Set(input.patternIds.filter(Boolean)))
  if (unique.length === 0) {
    return { updated: 0, disabled: 0 }
  }

  const store = await loadPatternStore()
  let updated = 0
  let disabled = 0

  const replyThreshold = input.replyThresholdDisable ?? 0.01

  for (const id of unique) {
    const pattern = store.patterns.find((p) => p.id === id)
    if (!pattern || pattern.status === 'disabled') continue

    const counts = derivedCounts(pattern)
    if (input.eventType === 'EMAIL_OPENED') counts.opens += 1
    if (input.eventType === 'EMAIL_REPLIED') counts.replies += 1
    if (input.eventType === 'EMAIL_BOUNCED') counts.bounces += 1

    updateRatesFromCounts(pattern, counts)
    updated += 1

    // Pruning rules
    if (pattern.usage_count > 100 && pattern.reply_rate < replyThreshold) {
      pattern.status = 'disabled'
      disabled += 1
    }
    if (pattern.usage_count > 50 && pattern.bounce_rate > 0.05) {
      pattern.status = 'disabled'
      disabled += 1
    }
  }

  await savePatternStore(store)

  // Ensure disabled patterns are persisted even if store did not contain them (edge cases)
  if (disabled > 0) {
    for (const id of unique) {
      const p = store.patterns.find((x) => x.id === id)
      if (p?.status === 'disabled') {
        await disablePattern(id)
      }
    }
  }

  return { updated, disabled }
}

