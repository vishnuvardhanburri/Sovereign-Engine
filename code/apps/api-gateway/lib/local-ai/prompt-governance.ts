import crypto from 'node:crypto'

export interface GovernanceVerdict {
  verdict: 'allow' | 'review' | 'block'
  riskScore: number
  piiMasked: boolean
  promptHash: string
  sanitizedText: string
  reasons: string[]
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/g
const HIGH_RISK_TERMS = [
  'bypass spam',
  'bypass gmail',
  'bypass outlook',
  'avoid detection',
  'unlimited emails',
  'mass blast',
  'scrape private',
]

export function maskPii(text: string): { text: string; masked: boolean } {
  let masked = false
  const result = text
    .replace(EMAIL_RE, () => {
      masked = true
      return '[email]'
    })
    .replace(PHONE_RE, () => {
      masked = true
      return '[phone]'
    })
  return { text: result, masked }
}

export function evaluatePromptGovernance(text: string): GovernanceVerdict {
  const pii = maskPii(text)
  const lower = pii.text.toLowerCase()
  const reasons = HIGH_RISK_TERMS.filter((term) => lower.includes(term))
  const riskScore = Math.min(100, reasons.length * 35 + (pii.masked ? 5 : 0))
  const verdict = riskScore >= 70 ? 'block' : riskScore >= 35 ? 'review' : 'allow'

  return {
    verdict,
    riskScore,
    piiMasked: pii.masked,
    promptHash: crypto.createHash('sha256').update(text).digest('hex'),
    sanitizedText: pii.text,
    reasons,
  }
}
