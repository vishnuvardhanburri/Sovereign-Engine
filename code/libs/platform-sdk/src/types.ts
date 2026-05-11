export type ProviderLane = 'gmail' | 'outlook' | 'yahoo' | 'icloud' | 'other'

export type LaneStatus = 'healthy' | 'throttled' | 'paused'

export interface ProviderLaneState {
  provider: ProviderLane
  status: LaneStatus
  maxPerHour: number
  deferralRate1h: number
  blockRate1h: number
  seedPlacementInboxRate?: number
  updatedAt: string
  reason?: string
}

export interface HealthStats {
  ok: boolean
  generatedAt: string
  dbLatencyMs: number
  redisLatencyMs: number
  queue: {
    waiting: number
    active: number
    delayed: number
    failed: number
  }
  workers: Array<{
    id: string
    role: string
    status: 'active' | 'idle' | 'offline'
    lastHeartbeatAt: string
    region?: string
  }>
}

export interface ReputationEvent {
  id: string
  timestampUtc: string
  clientId: string
  domain: string
  provider: ProviderLane
  actionType: string
  summary: string
  actorId?: string
}

export interface ReputationSnapshot {
  clientId: string
  domain?: string
  lanes: ProviderLaneState[]
  events: ReputationEvent[]
  health?: HealthStats
}

export interface OperationalActionRequest {
  clientId: string
  domain?: string
  provider?: ProviderLane
  action: 'pause_lane' | 'resume_lane' | 'pause_all' | 'resume_all' | 'acknowledge_alert'
  reason: string
  actorId: string
  deviceId: string
  nonce: string
  timestampUtc: string
  signature?: string
}

export interface OperationalActionResult {
  ok: boolean
  actionId?: string
  reconciledAt: string
  authoritativeState?: ReputationSnapshot
  error?: string
}

export type RealtimeEvent =
  | { type: 'lane.state.changed'; payload: ProviderLaneState }
  | { type: 'reputation.event.created'; payload: ReputationEvent }
  | { type: 'health.stats.updated'; payload: HealthStats }
  | { type: 'operator.action.reconciled'; payload: OperationalActionResult }
  | { type: 'system.notice'; payload: { level: 'info' | 'warning' | 'critical'; message: string } }
