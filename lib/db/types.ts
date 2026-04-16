export interface Domain {
  id: number
  domain: string
  status: 'active' | 'paused' | 'warming'
  warmup_stage: number
  daily_limit: number
  sent_today: number
  health_score: number
  bounce_rate: number
  reply_rate: number
  last_reset_at: string
  created_at: string
  updated_at: string
}

export interface Identity {
  id: number
  domain_id: number
  email: string
  daily_limit: number
  sent_today: number
  last_sent_at: string | null
  status: 'active' | 'paused' | 'inactive'
  created_at: string
  updated_at: string
}

export interface Event {
  id: number
  identity_id: number
  type: 'sent' | 'bounce' | 'reply' | 'complaint'
  contact_email: string | null
  campaign_id: number | null
  metadata: Record<string, any> | null
  created_at: string
}

export interface QueueJob {
  id: number
  contact_id: number
  campaign_id: number
  domain_id: number
  scheduled_at: string | null
  status: 'pending' | 'processing' | 'completed' | 'failed'
  attempt_count: number
  error_message: string | null
  created_at: string
  updated_at: string
}

export interface DomainWithStats extends Domain {
  identity_count: number
  today_sent: number
  capacity_remaining: number
}

export interface IdentityWithDomain extends Identity {
  domain: Domain
}

export type EventType = 'sent' | 'bounce' | 'reply' | 'complaint'
