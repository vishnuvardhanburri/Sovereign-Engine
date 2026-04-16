CREATE TABLE IF NOT EXISTS clients (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  offer_summary TEXT,
  target_audience TEXT,
  proof_points TEXT,
  telegram_chat_id TEXT,
  operator_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contacts (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  email_domain TEXT,
  name TEXT,
  company TEXT,
  company_domain TEXT,
  title TEXT,
  timezone TEXT,
  source TEXT,
  custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  enrichment JSONB,
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (
    verification_status IN ('pending', 'valid', 'invalid', 'catch_all', 'unknown', 'do_not_mail')
  ),
  verification_sub_status TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'replied', 'bounced', 'unsubscribed')
  ),
  unsubscribed_at TIMESTAMP,
  bounced_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (client_id, email)
);

CREATE TABLE IF NOT EXISTS sequences (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sequence_steps (
  id BIGSERIAL PRIMARY KEY,
  sequence_id BIGINT NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  step_index INT NOT NULL,
  day_delay INT NOT NULL DEFAULT 0,
  touch_label TEXT NOT NULL DEFAULT 'touch',
  variant_key TEXT NOT NULL DEFAULT 'primary',
  recipient_strategy TEXT NOT NULL DEFAULT 'primary' CHECK (
    recipient_strategy IN ('primary', 'cxo', 'generic', 'fallback')
  ),
  cc_mode TEXT NOT NULL DEFAULT 'none' CHECK (
    cc_mode IN ('none', 'manager', 'team')
  ),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (sequence_id, step_index)
);

CREATE TABLE IF NOT EXISTS campaigns (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  sequence_id BIGINT NOT NULL REFERENCES sequences(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'active', 'paused', 'completed')
  ),
  contact_count INT NOT NULL DEFAULT 0,
  sent_count INT NOT NULL DEFAULT 0,
  reply_count INT NOT NULL DEFAULT 0,
  bounce_count INT NOT NULL DEFAULT 0,
  open_count INT NOT NULL DEFAULT 0,
  angle TEXT NOT NULL DEFAULT 'pattern' CHECK (
    angle IN ('pattern', 'pain', 'authority')
  ),
  from_identity_mode TEXT NOT NULL DEFAULT 'rotate' CHECK (
    from_identity_mode IN ('rotate', 'sticky', 'manual')
  ),
  timezone_strategy TEXT NOT NULL DEFAULT 'contact' CHECK (
    timezone_strategy IN ('contact', 'client', 'utc')
  ),
  ab_test_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  daily_target INT NOT NULL DEFAULT 50,
  active_lead_count INT NOT NULL DEFAULT 0,
  last_enqueued_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS domains (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'paused', 'warming')
  ),
  warmup_stage INT NOT NULL DEFAULT 1,
  spf_valid BOOLEAN NOT NULL DEFAULT FALSE,
  dkim_valid BOOLEAN NOT NULL DEFAULT FALSE,
  dmarc_valid BOOLEAN NOT NULL DEFAULT FALSE,
  daily_limit INT NOT NULL DEFAULT 400,
  sent_today INT NOT NULL DEFAULT 0,
  sent_count INT NOT NULL DEFAULT 0,
  bounce_count INT NOT NULL DEFAULT 0,
  health_score NUMERIC(5,2) NOT NULL DEFAULT 100,
  bounce_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  last_reset_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (client_id, domain)
);

CREATE TABLE IF NOT EXISTS identities (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  domain_id BIGINT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  daily_limit INT NOT NULL DEFAULT 200,
  sent_today INT NOT NULL DEFAULT 0,
  sent_count INT NOT NULL DEFAULT 0,
  last_sent_at TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'paused', 'inactive')
  ),
  last_reset_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (client_id, email)
);

CREATE TABLE IF NOT EXISTS suppression_list (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (
    reason IN ('unsubscribed', 'bounced', 'duplicate', 'complaint', 'manual')
  ),
  source TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (client_id, email)
);

CREATE TABLE IF NOT EXISTS queue_jobs (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contact_id BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  sequence_step INT NOT NULL,
  scheduled_at TIMESTAMP NOT NULL,
  recipient_email TEXT,
  cc_emails JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'processing', 'retry', 'completed', 'failed', 'skipped')
  ),
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  last_error TEXT,
  provider_message_id TEXT,
  reserved_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (campaign_id, contact_id, sequence_step)
);

CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  campaign_id BIGINT REFERENCES campaigns(id) ON DELETE SET NULL,
  contact_id BIGINT REFERENCES contacts(id) ON DELETE SET NULL,
  identity_id BIGINT REFERENCES identities(id) ON DELETE SET NULL,
  domain_id BIGINT REFERENCES domains(id) ON DELETE SET NULL,
  queue_job_id BIGINT REFERENCES queue_jobs(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'queued',
      'sent',
      'failed',
      'bounce',
      'reply',
      'complaint',
      'skipped',
      'retry',
      'unsubscribed'
    )
  ),
  provider_message_id TEXT,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE events
  DROP CONSTRAINT IF EXISTS events_event_type_check;

ALTER TABLE events
  ADD CONSTRAINT events_event_type_check CHECK (
    event_type IN (
      'queued',
      'sent',
      'delivered',
      'opened',
      'clicked',
      'failed',
      'bounce',
      'reply',
      'complaint',
      'skipped',
      'retry',
      'unsubscribed'
    )
  );

CREATE TABLE IF NOT EXISTS operator_actions (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  campaign_id BIGINT REFERENCES campaigns(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  password_hash TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS client_users (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (client_id, user_id)
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, external_id)
);

CREATE INDEX IF NOT EXISTS idx_contacts_client_email
  ON contacts (client_id, email);
CREATE INDEX IF NOT EXISTS idx_contacts_client_email_domain
  ON contacts (client_id, email_domain);
CREATE INDEX IF NOT EXISTS idx_contacts_company_domain
  ON contacts (client_id, company_domain);
CREATE INDEX IF NOT EXISTS idx_contacts_client_status
  ON contacts (client_id, status);
CREATE INDEX IF NOT EXISTS idx_campaigns_client_status
  ON campaigns (client_id, status);
CREATE INDEX IF NOT EXISTS idx_campaigns_client_created
  ON campaigns (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_domains_client_status
  ON domains (client_id, status);
CREATE INDEX IF NOT EXISTS idx_identities_client_domain
  ON identities (client_id, domain_id);
CREATE INDEX IF NOT EXISTS idx_identities_client_status
  ON identities (client_id, status);
CREATE INDEX IF NOT EXISTS idx_queue_jobs_client_status
  ON queue_jobs (client_id, status);
CREATE INDEX IF NOT EXISTS idx_queue_jobs_campaign_status
  ON queue_jobs (campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_queue_jobs_scheduled
  ON queue_jobs (scheduled_at);
CREATE INDEX IF NOT EXISTS idx_queue_jobs_recipient_email
  ON queue_jobs (recipient_email);
CREATE INDEX IF NOT EXISTS idx_events_client_created
  ON events (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_campaign
  ON events (campaign_id);
CREATE INDEX IF NOT EXISTS idx_events_type
  ON events (event_type);
CREATE INDEX IF NOT EXISTS idx_operator_actions_client_created
  ON operator_actions (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_users_client_role
  ON client_users (client_id, role);
CREATE INDEX IF NOT EXISTS idx_suppression_client_email
  ON suppression_list (client_id, email);
CREATE INDEX IF NOT EXISTS idx_webhook_events_provider_created
  ON webhook_events (provider, created_at DESC);

INSERT INTO clients (id, name)
VALUES (1, 'Default Client')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS offer_summary TEXT,
  ADD COLUMN IF NOT EXISTS target_audience TEXT,
  ADD COLUMN IF NOT EXISTS proof_points TEXT,
  ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT,
  ADD COLUMN IF NOT EXISTS operator_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS email_domain TEXT,
  ADD COLUMN IF NOT EXISTS company_domain TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS timezone TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS enrichment JSONB,
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS verification_sub_status TEXT;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS angle TEXT NOT NULL DEFAULT 'pattern',
  ADD COLUMN IF NOT EXISTS from_identity_mode TEXT NOT NULL DEFAULT 'rotate',
  ADD COLUMN IF NOT EXISTS timezone_strategy TEXT NOT NULL DEFAULT 'contact',
  ADD COLUMN IF NOT EXISTS ab_test_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS daily_target INT NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS active_lead_count INT NOT NULL DEFAULT 0;

ALTER TABLE sequence_steps
  ADD COLUMN IF NOT EXISTS touch_label TEXT NOT NULL DEFAULT 'touch',
  ADD COLUMN IF NOT EXISTS variant_key TEXT NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS recipient_strategy TEXT NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS cc_mode TEXT NOT NULL DEFAULT 'none';

ALTER TABLE domains
  ADD COLUMN IF NOT EXISTS warmup_stage INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS spf_valid BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS dkim_valid BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS dmarc_valid BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE queue_jobs
  ADD COLUMN IF NOT EXISTS recipient_email TEXT,
  ADD COLUMN IF NOT EXISTS cc_emails JSONB,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE contacts
SET email_domain = LOWER(SPLIT_PART(email, '@', 2))
WHERE email_domain IS NULL;
