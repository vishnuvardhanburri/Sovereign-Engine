import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const plans = {
  starter: {
    name: 'Starter',
    price: '$1,499/mo',
    limits: { domains: 10, apiRequestsPerDay: 10000, dailyControlPlaneVolume: 25000, simulatedEventsPerRun: 10000 },
  },
  growth: {
    name: 'Growth',
    price: '$4,999/mo',
    limits: { domains: 75, apiRequestsPerDay: 100000, dailyControlPlaneVolume: 100000, simulatedEventsPerRun: 10000 },
  },
  enterprise: {
    name: 'Enterprise',
    price: 'From $12,000/mo',
    limits: { domains: 250, apiRequestsPerDay: 500000, dailyControlPlaneVolume: 250000, simulatedEventsPerRun: 10000 },
  },
}

function hash(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function configuredLicenses() {
  const raw = process.env.SOVEREIGN_LICENSE_KEYS || ''
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function resolvePlan(key: string) {
  if (/enterprise/i.test(key)) return plans.enterprise
  if (/growth/i.test(key)) return plans.growth
  return plans.starter
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const licenseKey = String(body.license_key || body.licenseKey || '')
  const instanceId = String(body.instance_id || body.instanceId || 'unregistered-instance')
  const configured = configuredLicenses()
  const demoAllowed = process.env.NODE_ENV !== 'production' || process.env.MOCK_SMTP === 'true'
  const active =
    configured.length > 0
      ? configured.includes(licenseKey)
      : demoAllowed && /^se_(starter|growth|enterprise)_demo_[a-z0-9-]*$/i.test(licenseKey)

  const plan = resolvePlan(licenseKey)
  const generatedAt = new Date().toISOString()

  return NextResponse.json(
    {
      ok: true,
      active,
      product: 'Sovereign Engine',
      positioning: 'Deliverability Operating System (Outbound Revenue Protection Infrastructure)',
      plan,
      license: {
        fingerprint: licenseKey ? hash(licenseKey).slice(0, 16) : null,
        instance_id: instanceId,
        validated_at: generatedAt,
        expires_at: active ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : null,
      },
      acquisitionNote:
        'Demo licenses are for acquisition validation only. Production buyers should configure SOVEREIGN_LICENSE_KEYS or replace this endpoint with their billing provider.',
    },
    { status: active ? 200 : 401 }
  )
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: '/api/v1/license/validate',
    method: 'POST',
    demoLicenseKeys: ['se_starter_demo_acquire', 'se_growth_demo_acquire', 'se_enterprise_demo_acquire'],
    pricing: {
      starter: plans.starter.price,
      growth: plans.growth.price,
      enterprise: plans.enterprise.price,
    },
  })
}
