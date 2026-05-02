import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const configuredKey = process.env.SOVEREIGN_LICENSE_KEY || ''
  const submittedKey = body.license_key || request.headers.get('x-sovereign-license') || configuredKey
  const demoMode = process.env.SOVEREIGN_LICENSE_DEMO_MODE !== 'false'

  if (!submittedKey && !demoMode) {
    return NextResponse.json({ valid: false, reason: 'LICENSE_REQUIRED' }, { status: 402 })
  }
  if (configuredKey && submittedKey !== configuredKey) {
    return NextResponse.json({ valid: false, reason: 'LICENSE_INVALID' }, { status: 403 })
  }

  return NextResponse.json({
    valid: true,
    mode: configuredKey ? 'LICENSED' : 'DEMO_VALIDATION_STUB',
    plan: process.env.SOVEREIGN_LICENSE_PLAN || 'ENTERPRISE',
    tenant_id: body.tenant_id || 'demo-tenant',
    features: ['domain_protection', 'reputation_control', 'queue_telemetry', 'worker_scaling'],
    note: 'License validation stub for SaaS monetization diligence.',
  })
}
