import crypto from 'node:crypto'
import type { CatchAllResult, DnsMxResult } from './types'
import { smtpVerifyRcpt } from './smtp-probe'

export async function detectCatchAll(opts: {
  domain: string
  mx: DnsMxResult
  port: number
  timeoutMs: number
  heloName: string
  fromEmail: string
}): Promise<CatchAllResult> {
  if (!opts.mx.ok || opts.mx.mxHosts.length === 0) return { ok: false, reason: 'dns_error' }
  const mxHost = opts.mx.mxHosts[0].host
  const randomLocal = `xv_${crypto.randomBytes(6).toString('hex')}`
  const randomEmail = `${randomLocal}@${opts.domain}`

  const rcpt = await smtpVerifyRcpt({
    mxHost,
    port: opts.port,
    timeoutMs: opts.timeoutMs,
    heloName: opts.heloName,
    fromEmail: opts.fromEmail,
    toEmail: randomEmail,
  })

  if (rcpt.kind === 'deliverable') return { ok: true, isCatchAll: true }
  if (rcpt.kind === 'undeliverable') return { ok: true, isCatchAll: false }
  if (rcpt.kind === 'timeout') return { ok: false, reason: 'timeout' }
  return { ok: false, reason: 'smtp_unavailable' }
}

