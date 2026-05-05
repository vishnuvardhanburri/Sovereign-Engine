import { NextRequest, NextResponse } from 'next/server'
import {
  authenticatePublicApiKey,
  buildHealthCertificate,
  enforcePublicRateLimit,
  logReputationApiCall,
  type PublicReputationInput,
} from '@/lib/public-reputation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(error: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...extra }, { status })
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  const apiKey = await authenticatePublicApiKey(request)
  if (!apiKey) return jsonError('unauthorized', 401)

  let rateLimit
  try {
    rateLimit = await enforcePublicRateLimit(apiKey)
  } catch {
    return jsonError('rate_limiter_unavailable', 503)
  }

  if (!rateLimit.allowed) {
    return jsonError('rate_limit_exceeded', 429, {
      rate_limit: {
        tier: apiKey.tier,
        used: rateLimit.used,
        limit: rateLimit.limit,
        reset_at: rateLimit.resetAt,
      },
    })
  }

  let payload: PublicReputationInput
  try {
    payload = (await request.json()) as PublicReputationInput
  } catch {
    return jsonError('invalid_json', 400)
  }

  try {
    const result = await buildHealthCertificate(payload)
    const latencyMs = Date.now() - startedAt

    await logReputationApiCall({
      apiKey,
      payload,
      responseStatus: 200,
      reputationScore: result.logMeta.reputationScore,
      cacheHit: result.logMeta.cacheHit,
      latencyMs,
    })

    return NextResponse.json({
      ...result.certificate,
      billing: {
        tier: apiKey.tier,
        billable_units: 1,
        usage_today: rateLimit.used,
        daily_limit: rateLimit.limit,
        reset_at: rateLimit.resetAt,
      },
      performance: {
        latency_ms: latencyMs,
        cache_hit: result.logMeta.cacheHit,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message === 'domain_or_ip_required') return jsonError('domain_or_ip_required', 400)
    if (message === 'invalid_domain') return jsonError('invalid_domain', 400)
    if (message === 'invalid_ip') return jsonError('invalid_ip', 400)
    console.error('[api/v1/reputation/score] failed', error)
    return jsonError('failed', 500)
  }
}
