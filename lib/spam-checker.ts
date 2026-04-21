import { analyzeEmailForSpamRisk } from '@/lib/agents/spam-filter-agent'

export interface SpamCheckResult {
  score: number // 0-100, higher = riskier
  blocked: boolean
  reasons: string[]
}

export function scoreEmail(subject: string, body: string): SpamCheckResult {
  const analysis = analyzeEmailForSpamRisk({ subject, body })
  const score = Math.max(0, Math.min(100, analysis.spamScore))
  const blocked = analysis.riskLevel === 'critical' || score >= 75
  return {
    score,
    blocked,
    reasons: analysis.issues.map((i) => i.message),
  }
}

