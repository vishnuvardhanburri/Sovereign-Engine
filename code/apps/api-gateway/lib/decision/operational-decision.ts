import { queryOne } from '@/lib/db'
import { detectMailboxProvider, providerRiskFloor, type MailboxProvider } from '@/lib/decision/provider-ecosystem'

export type OutboundDecisionAction = 'send' | 'throttle' | 'hold' | 'suppress'
export type ProviderLaneName = 'standard' | 'low_risk' | 'recovery' | 'paused'

export interface OutboundDecisionInput {
  clientId: number
  email: string
  priorityScore: number
  deliverabilityRiskScore: number
  hasPublicEvidence?: boolean
  suppressionMatched?: boolean
}

export interface OutboundDecision {
  action: OutboundDecisionAction
  provider: MailboxProvider
  lane: ProviderLaneName
  reason: string
  riskScore: number
  throttleFactor: number
  maxPerHour: number
}

interface ProviderLaneRow {
  provider: MailboxProvider
  lane: ProviderLaneName
  status: string
  throttle_factor: string
  emergency_brake_active: boolean
  max_per_hour: number
  bounce_rate_24h: string
  failure_rate_24h: string
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100))
}

async function getLane(clientId: number, provider: MailboxProvider, preferredLane: ProviderLaneName): Promise<ProviderLaneRow | null> {
  return queryOne<ProviderLaneRow>(
    `SELECT provider,
            lane,
            status,
            throttle_factor::text,
            emergency_brake_active,
            max_per_hour,
            bounce_rate_24h::text,
            failure_rate_24h::text
     FROM provider_lanes
     WHERE client_id = $1
       AND provider = $2
       AND lane = $3
     LIMIT 1`,
    [clientId, provider, preferredLane]
  )
}

export async function decideOutboundAction(input: OutboundDecisionInput): Promise<OutboundDecision> {
  const provider = detectMailboxProvider(input.email)
  const baseRisk = clamp(providerRiskFloor(provider) + input.deliverabilityRiskScore * 0.72 - input.priorityScore * 0.16)
  const lane: ProviderLaneName = baseRisk >= 58 ? 'low_risk' : 'standard'
  const laneState = (await getLane(input.clientId, provider, lane)) ?? (await getLane(input.clientId, 'other', 'standard'))
  const bouncePressure = Number(laneState?.bounce_rate_24h ?? 0)
  const failurePressure = Number(laneState?.failure_rate_24h ?? 0)
  const telemetryRisk = clamp((bouncePressure + failurePressure) * 100)
  const riskScore = clamp(baseRisk + telemetryRisk)

  if (input.suppressionMatched) {
    return {
      action: 'suppress',
      provider,
      lane: 'paused',
      reason: 'suppression_list_match',
      riskScore: 100,
      throttleFactor: 0,
      maxPerHour: 0,
    }
  }

  if (laneState?.emergency_brake_active || laneState?.status === 'paused') {
    return {
      action: 'hold',
      provider,
      lane: laneState?.lane ?? 'paused',
      reason: 'provider_lane_emergency_brake',
      riskScore,
      throttleFactor: 0,
      maxPerHour: 0,
    }
  }

  if (!input.hasPublicEvidence && riskScore >= 62) {
    return {
      action: 'hold',
      provider,
      lane,
      reason: 'evidence_required_for_risky_recipient',
      riskScore,
      throttleFactor: Number(laneState?.throttle_factor ?? 0.5),
      maxPerHour: Number(laneState?.max_per_hour ?? 10),
    }
  }

  if (riskScore >= 72) {
    return {
      action: 'throttle',
      provider,
      lane: 'recovery',
      reason: 'high_provider_or_recipient_risk',
      riskScore,
      throttleFactor: 0.25,
      maxPerHour: Math.max(1, Math.floor(Number(laneState?.max_per_hour ?? 10) * 0.25)),
    }
  }

  return {
    action: 'send',
    provider,
    lane,
    reason: riskScore >= 50 ? 'low_risk_lane_required' : 'provider_lane_healthy',
    riskScore,
    throttleFactor: Number(laneState?.throttle_factor ?? 1),
    maxPerHour: Number(laneState?.max_per_hour ?? 20),
  }
}
