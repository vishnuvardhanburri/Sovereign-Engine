import type { CatchAllResult, DnsMxResult, SmtpClassification, ValidatorVerdict } from './types'
import { isDisposableDomain, isRoleAddress } from './normalize'

export function scoreEmail(input: {
  local: string
  domain: string
  mx: DnsMxResult
  smtp: SmtpClassification | null
  catchAll: CatchAllResult | null
}): { score: number; verdict: ValidatorVerdict; reasons: string[] } {
  let score = 0
  const reasons: string[] = []

  if (input.mx.ok) {
    score += 0.2
  } else {
    reasons.push(`mx:${input.mx.reason}`)
  }

  if (input.smtp) {
    if (input.smtp.kind === 'deliverable') score += 0.6
    if (input.smtp.kind === 'undeliverable') {
      reasons.push('smtp:undeliverable')
      return { score: 0, verdict: 'invalid', reasons }
    }
    if (input.smtp.kind === 'soft_fail') reasons.push('smtp:soft_fail')
    if (input.smtp.kind === 'timeout') reasons.push('smtp:timeout')
  } else {
    reasons.push('smtp:skipped')
  }

  if (input.catchAll?.ok && input.catchAll.isCatchAll) {
    // Catch-all means deliverable does not guarantee mailbox exists.
    score -= 0.15
    reasons.push('catchall:true')
  }

  if (isDisposableDomain(input.domain)) {
    score -= 0.2
    reasons.push('disposable_domain')
  }
  // Role addresses are handled as "risky" policy at the pipeline layer (not reject).
  if (isRoleAddress(input.local)) score -= 0.2

  score = Math.max(0, Math.min(1, Number(score.toFixed(2))))

  let verdict: ValidatorVerdict = 'unknown'
  if (score >= 0.75) verdict = 'valid'
  else if (score >= 0.45) verdict = 'risky'
  else if (score > 0) verdict = 'unknown'
  else verdict = 'invalid'

  return { score, verdict, reasons }
}
