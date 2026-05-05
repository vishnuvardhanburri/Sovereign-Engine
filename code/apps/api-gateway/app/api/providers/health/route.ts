import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { resolveClientId } from '@/lib/client-context'

function providerFromEmail(email: string | null): 'gmail' | 'outlook' | 'yahoo' | 'other' {
  const d = String(email ?? '').toLowerCase().split('@')[1] ?? ''
  if (!d) return 'other'
  if (d === 'gmail.com' || d === 'googlemail.com') return 'gmail'
  if (['outlook.com', 'hotmail.com', 'live.com', 'msn.com'].includes(d)) return 'outlook'
  if (d === 'yahoo.com' || d.endsWith('.yahoo.com')) return 'yahoo'
  return 'other'
}

export async function GET(request: NextRequest) {
  try {
    const clientId = await resolveClientId({ headers: request.headers })

    const res = await query<{ to_email: string | null; event_type: string; smtp_class: string | null }>(
      `SELECT
         COALESCE(metadata->>'to_email', NULL) AS to_email,
         event_type,
         COALESCE(metadata->>'smtp_class', NULL) AS smtp_class
       FROM events
       WHERE client_id = $1
         AND created_at > (CURRENT_TIMESTAMP - INTERVAL '1 hour')
         AND event_type IN ('sent','failed','bounce')`,
      [clientId]
    )

    const buckets = new Map<string, { sent: number; failed: number; bounce: number; deferral: number; block: number }>()
    const ensure = (p: string) =>
      buckets.get(p) ??
      (buckets.set(p, { sent: 0, failed: 0, bounce: 0, deferral: 0, block: 0 }), buckets.get(p)!)

    for (const r of res.rows) {
      const p = providerFromEmail(r.to_email)
      const b = ensure(p)
      if (r.event_type === 'sent') b.sent++
      else if (r.event_type === 'bounce') b.bounce++
      else if (r.event_type === 'failed') {
        b.failed++
        if (r.smtp_class === 'deferral') b.deferral++
        if (r.smtp_class === 'block') b.block++
      }
    }

    const out = Array.from(buckets.entries()).map(([provider, b]) => {
      const attempts = b.sent + b.failed + b.bounce
      const success_rate = attempts > 0 ? b.sent / attempts : 1
      const deferral_rate = attempts > 0 ? b.deferral / attempts : 0
      const block_rate = attempts > 0 ? b.block / attempts : 0
      // throttle factor is derived (best-effort). UI can combine with Redis provider risk later.
      const throttle_factor = block_rate > 0.02 ? 0.6 : deferral_rate > 0.1 ? 0.8 : 1
      return { provider, attempts, success_rate, deferral_rate, block_rate, throttle_factor }
    })

    return NextResponse.json({ ok: true, clientId, window: '1h', providers: out })
  } catch (err) {
    console.error('[api/providers/health] failed', err)
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 })
  }
}

