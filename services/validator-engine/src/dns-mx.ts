import { promises as dns } from 'node:dns'
import type { DnsMxResult } from './types'

export async function resolveMx(domain: string): Promise<DnsMxResult> {
  try {
    const mx = await dns.resolveMx(domain)
    if (!mx || mx.length === 0) return { ok: false, reason: 'no_mx' }
    const mxHosts = mx
      .map((r) => ({ host: r.exchange.endsWith('.') ? r.exchange.slice(0, -1) : r.exchange, priority: r.priority }))
      .sort((a, b) => a.priority - b.priority)
    return { ok: true, mxHosts }
  } catch {
    return { ok: false, reason: 'dns_error' }
  }
}

