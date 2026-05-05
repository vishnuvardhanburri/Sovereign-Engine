export type Lane = 'normal' | 'low_risk' | 'slow'

export type ValidationVerdict = 'valid' | 'risky' | 'invalid' | 'unknown'

export type TrackingEventType = 'SENT' | 'FAILED' | 'BOUNCED' | 'REPLIED'

export interface SendIdentitySelection {
  identity: {
    id: number
    email: string
    domain_id: number
    daily_limit: number
    sent_today: number
    last_sent_at?: string | null
  }
  domain: {
    id: number
    domain: string
    daily_limit: number
    sent_today: number
    health_score: number
    bounce_rate: number
    spf_valid?: boolean
    dkim_valid?: boolean
    dmarc_valid?: boolean
  }
}

export interface TrackingIngestEvent {
  type: TrackingEventType
  clientId: number
  campaignId?: number | null
  contactId?: number | null
  identityId?: number | null
  domainId?: number | null
  queueJobId?: number | null
  providerMessageId?: string | null
  metadata?: Record<string, unknown> | null
  occurredAt?: Date
}

export type DbExecutor = <T = unknown>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount: number }>

