export type ValidatorVerdict = 'valid' | 'risky' | 'invalid' | 'unknown'

export type SmtpClassification =
  | { kind: 'deliverable' }
  | { kind: 'undeliverable'; code?: number; message?: string }
  | { kind: 'soft_fail'; code?: number; message?: string }
  | { kind: 'timeout' }

export type DnsMxResult =
  | { ok: true; mxHosts: Array<{ host: string; priority: number }> }
  | { ok: false; reason: 'no_mx' | 'dns_error' }

export type CatchAllResult =
  | { ok: true; isCatchAll: boolean }
  | { ok: false; reason: 'dns_error' | 'smtp_unavailable' | 'timeout' }

export type ValidationResult = {
  email: string
  normalizedEmail: string
  verdict: ValidatorVerdict
  score: number // 0..1
  reasons: string[]
  mx: DnsMxResult
  smtp: SmtpClassification | null
  catchAll: CatchAllResult | null
  meta: {
    durationMs: number
    domain: string
    localPart: string
    usedMxHost?: string
  }
}

