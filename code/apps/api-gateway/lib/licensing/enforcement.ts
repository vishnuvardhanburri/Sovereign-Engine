import { query, queryOne } from '@/lib/db'
import { appendOperationalEvent } from '@/lib/operational-events'

export type LicenseType = 'internal_enterprise' | 'white_label_commercial' | 'maintenance' | 'trial'
export type UsageMeterType =
  | 'api_call'
  | 'ingestion_record'
  | 'send_attempt'
  | 'ai_inference'
  | 'crm_sync'
  | 'workflow_action'
  | 'websocket_event'

export interface LicenseState {
  clientId: number
  licenseType: LicenseType
  status: string
  features: Record<string, unknown>
  limits: {
    apiMonthly: number
    ingestionMonthly: number
    sendMonthly: number
    childTenants: number
  }
}

interface LicenseRow {
  client_id: string
  license_type: LicenseType
  status: string
  api_monthly_limit: number
  ingestion_monthly_limit: number
  send_monthly_limit: number
  child_tenant_limit: number
  features: Record<string, unknown>
}

const FEATURE_LICENSES: Record<string, LicenseType[]> = {
  autonomous_ingestion: ['internal_enterprise', 'white_label_commercial', 'trial'],
  command_center: ['internal_enterprise', 'white_label_commercial', 'maintenance', 'trial'],
  local_ai: ['internal_enterprise', 'white_label_commercial', 'trial'],
  white_label: ['white_label_commercial'],
  crm_sync: ['internal_enterprise', 'white_label_commercial', 'trial'],
}

export async function getLicenseState(clientId: number): Promise<LicenseState> {
  const row = await queryOne<LicenseRow>(
    `SELECT client_id::text,
            license_type,
            status,
            api_monthly_limit,
            ingestion_monthly_limit,
            send_monthly_limit,
            child_tenant_limit,
            features
     FROM tenant_licenses
     WHERE client_id = $1
       AND status IN ('active', 'trialing')
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY
       CASE license_type
         WHEN 'white_label_commercial' THEN 1
         WHEN 'internal_enterprise' THEN 2
         WHEN 'maintenance' THEN 3
         ELSE 4
       END
     LIMIT 1`,
    [clientId]
  )

  if (!row) {
    return {
      clientId,
      licenseType: 'trial',
      status: 'trialing',
      features: {
        autonomous_ingestion: true,
        command_center: true,
        local_ai: true,
      },
      limits: {
        apiMonthly: 1000,
        ingestionMonthly: 2500,
        sendMonthly: 500,
        childTenants: 0,
      },
    }
  }

  return {
    clientId: Number(row.client_id),
    licenseType: row.license_type,
    status: row.status,
    features: row.features ?? {},
    limits: {
      apiMonthly: Number(row.api_monthly_limit),
      ingestionMonthly: Number(row.ingestion_monthly_limit),
      sendMonthly: Number(row.send_monthly_limit),
      childTenants: Number(row.child_tenant_limit),
    },
  }
}

export async function enforceFeature(clientId: number, feature: string): Promise<LicenseState> {
  const state = await getLicenseState(clientId)
  const explicitFlag = state.features[feature]
  const allowedByFlag = explicitFlag === true
  const allowedByLicense = (FEATURE_LICENSES[feature] ?? []).includes(state.licenseType)

  if (!allowedByFlag && !allowedByLicense) {
    await appendOperationalEvent({
      clientId,
      eventType: 'license.feature_blocked',
      aggregateType: 'license',
      aggregateId: state.licenseType,
      payload: { feature, licenseType: state.licenseType, status: state.status },
    })
    throw new Error(`license_feature_not_enabled:${feature}`)
  }

  return state
}

export async function recordUsage(input: {
  clientId: number
  meterType: UsageMeterType
  quantity?: number
  source?: string
  idempotencyKey?: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  await query(
    `INSERT INTO usage_meter_events (
       client_id,
       meter_type,
       quantity,
       source,
       idempotency_key,
       metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT DO NOTHING`,
    [
      input.clientId,
      input.meterType,
      input.quantity ?? 1,
      input.source ?? 'system',
      input.idempotencyKey ?? null,
      JSON.stringify(input.metadata ?? {}),
    ]
  )
}

export async function usageSummary(clientId: number): Promise<Record<UsageMeterType, number>> {
  const result = await query<{ meter_type: UsageMeterType; total: string }>(
    `SELECT meter_type, COALESCE(SUM(quantity), 0)::text AS total
     FROM usage_meter_events
     WHERE client_id = $1
       AND created_at >= date_trunc('month', now())
     GROUP BY meter_type`,
    [clientId]
  )

  return result.rows.reduce(
    (acc, row) => ({ ...acc, [row.meter_type]: Number(row.total) }),
    {
      api_call: 0,
      ingestion_record: 0,
      send_attempt: 0,
      ai_inference: 0,
      crm_sync: 0,
      workflow_action: 0,
      websocket_event: 0,
    } satisfies Record<UsageMeterType, number>
  )
}
