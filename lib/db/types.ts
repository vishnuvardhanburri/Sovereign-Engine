export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed'
export type ContactStatus = 'active' | 'replied' | 'bounced' | 'unsubscribed'
export type DomainStatus = 'active' | 'paused' | 'warming'
export type IdentityStatus = 'active' | 'paused' | 'inactive'
export type VerificationStatus =
  | 'pending'
  | 'valid'
  | 'invalid'
  | 'catch_all'
  | 'unknown'
  | 'do_not_mail'
export type QueueJobStatus =
  | 'pending'
  | 'processing'
  | 'retry'
  | 'completed'
  | 'failed'
  | 'skipped'
export type EventType =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'failed'
  | 'bounce'
  | 'reply'
  | 'complaint'
  | 'skipped'
  | 'retry'
  | 'unsubscribed'

export interface Client {
  id: number
  name: string
  offer_summary?: string | null
  target_audience?: string | null
  proof_points?: string | null
  telegram_chat_id?: string | null
  operator_enabled?: boolean
  created_at: string
  updated_at: string
}

export interface Contact {
  id: number
  client_id: number
  email: string
  email_domain: string | null
  name: string | null
  company: string | null
  company_domain: string | null
  title: string | null
  timezone: string | null
  source: string | null
  custom_fields: Record<string, unknown>
  enrichment: Record<string, unknown> | null
  verification_status: VerificationStatus
  verification_sub_status: string | null
  status: ContactStatus
  unsubscribed_at: string | null
  bounced_at: string | null
  created_at: string
  updated_at: string
}

export interface Sequence {
  id: number
  client_id: number
  name: string
  created_at: string
  updated_at: string
}

export interface SequenceStep {
  id: number
  sequence_id: number
  step_index: number
  day_delay: number
  touch_label: string
  variant_key: string
  recipient_strategy: 'primary' | 'cxo' | 'generic' | 'fallback'
  cc_mode: 'none' | 'manager' | 'team'
  subject: string
  body: string
  created_at: string
  updated_at: string
}

export interface Campaign {
  id: number
  client_id: number
  sequence_id: number
  name: string
  status: CampaignStatus
  contact_count: number
  sent_count: number
  reply_count: number
  bounce_count: number
  open_count: number
  angle?: 'pattern' | 'pain' | 'authority'
  from_identity_mode?: 'rotate' | 'sticky' | 'manual'
  timezone_strategy?: 'contact' | 'client' | 'utc'
  ab_test_enabled?: boolean
  daily_target?: number
  active_lead_count?: number
  last_enqueued_at: string | null
  created_at: string
  updated_at: string
}

export interface Domain {
  id: number
  client_id: number
  domain: string
  status: DomainStatus
  warmup_stage: number
  spf_valid: boolean
  dkim_valid: boolean
  dmarc_valid: boolean
  daily_limit: number
  sent_today: number
  sent_count: number
  bounce_count: number
  health_score: number
  bounce_rate: number
  last_reset_at: string
  created_at: string
  updated_at: string
}

export interface Identity {
  id: number
  client_id: number
  domain_id: number
  email: string
  daily_limit: number
  sent_today: number
  sent_count: number
  last_sent_at: string | null
  status: IdentityStatus
  last_reset_at: string
  created_at: string
  updated_at: string
}

export interface QueueJob {
  id: number
  client_id: number
  contact_id: number
  campaign_id: number
  sequence_step: number
  scheduled_at: string
  recipient_email: string | null
  cc_emails: string[] | null
  metadata: Record<string, unknown>
  status: QueueJobStatus
  attempts: number
  max_attempts: number
  last_error: string | null
  provider_message_id: string | null
  reserved_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface Event {
  id: number
  client_id: number
  campaign_id: number | null
  contact_id: number | null
  identity_id: number | null
  domain_id: number | null
  queue_job_id: number | null
  event_type: EventType
  provider_message_id: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface SuppressionEntry {
  id: number
  client_id: number
  email: string
  reason: 'unsubscribed' | 'bounced' | 'duplicate' | 'complaint' | 'manual'
  source: string | null
  created_at: string
}

export interface DomainWithStats extends Domain {
  identity_count: number
  capacity_remaining: number
  reply_rate: number
}

export interface CampaignRow extends Campaign {
  sequence_name: string
}

export interface OperatorAction {
  id: number
  client_id: number
  campaign_id: number | null
  action_type: string
  summary: string
  payload: Record<string, unknown> | null
  created_at: string
}

export interface User {
  id: number
  email: string
  name: string | null
  password_hash: string | null
  created_at: string
  updated_at: string
}

export interface ClientUser {
  id: number
  client_id: number
  user_id: number
  role: 'owner' | 'admin' | 'member'
  created_at: string
  updated_at: string
}

export interface WebhookEvent {
  id: number
  provider: string
  external_id: string
  event_type: string
  payload: Record<string, unknown>
  processed_at: string
  created_at: string
}
