import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { XAVIRA_COMMERCIAL_MODEL } from '@/lib/commercial-model'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const plans = {
  internal_enterprise: {
    name: XAVIRA_COMMERCIAL_MODEL.internalEnterpriseLicense.name,
    price: XAVIRA_COMMERCIAL_MODEL.internalEnterpriseLicense.label,
    currency: XAVIRA_COMMERCIAL_MODEL.currency,
    rights: ['internal_operational_usage'],
    restrictions: ['no_reseller_rights', 'no_white_label_rights', 'no_commercial_redistribution_rights'],
    limits: { domains: 25, apiRequestsPerDay: 100000, dailyControlPlaneVolume: 200000, simulatedEventsPerRun: 10000 },
  },
  white_label_commercial: {
    name: XAVIRA_COMMERCIAL_MODEL.whiteLabelCommercialLicense.name,
    price: XAVIRA_COMMERCIAL_MODEL.whiteLabelCommercialLicense.label,
    currency: XAVIRA_COMMERCIAL_MODEL.currency,
    rights: ['white_label', 'reseller', 'commercial_deployment', 'multi_client_operations', 'branding_customization'],
    restrictions: [],
    limits: { domains: 250, apiRequestsPerDay: 500000, dailyControlPlaneVolume: 1000000, simulatedEventsPerRun: 10000 },
  },
  operations_maintenance: {
    name: XAVIRA_COMMERCIAL_MODEL.operationsMaintenance.name,
    price: XAVIRA_COMMERCIAL_MODEL.operationsMaintenance.label,
    currency: XAVIRA_COMMERCIAL_MODEL.currency,
    rights: ['technical_support', 'platform_updates', 'infrastructure_guidance', 'monitoring_support', 'governance_support'],
    restrictions: ['requires_active_license'],
    limits: { domains: 250, apiRequestsPerDay: 500000, dailyControlPlaneVolume: 1000000, simulatedEventsPerRun: 10000 },
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
  if (/white|commercial|reseller|agency/i.test(key)) return plans.white_label_commercial
  if (/maintenance|support|operations/i.test(key)) return plans.operations_maintenance
  return plans.internal_enterprise
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
      : demoAllowed &&
        /^se_(internal_enterprise|white_label_commercial|operations_maintenance)_demo_[a-z0-9-]*$/i.test(
          licenseKey
        )

  const plan = resolvePlan(licenseKey)
  const generatedAt = new Date().toISOString()

  return NextResponse.json(
    {
      ok: true,
      active,
      product: XAVIRA_COMMERCIAL_MODEL.productName,
      positioning: 'Enterprise Communication Operations Platform and communication governance infrastructure',
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
    demoLicenseKeys: [
      'se_internal_enterprise_demo_acquire',
      'se_white_label_commercial_demo_acquire',
      'se_operations_maintenance_demo_acquire',
    ],
    pricing: {
      currency: XAVIRA_COMMERCIAL_MODEL.currency,
      internalEnterpriseLicense: plans.internal_enterprise.price,
      whiteLabelCommercialLicense: plans.white_label_commercial.price,
      operationsMaintenance: plans.operations_maintenance.price,
    },
  })
}
