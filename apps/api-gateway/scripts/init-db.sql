CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
  -- Structured outreach cycles: distribute contacts across a multi-day duration.
  -- We default to ~30 days so outreach behaves like a paced sequence, not bulk blast.
  duration_days INT NOT NULL DEFAULT 30,
  -- Strict mode separation: auto audiences vs manual uploaded contacts.
  audience_mode TEXT NOT NULL DEFAULT 'auto' CHECK (audience_mode IN ('auto', 'manual')),
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

-- Backward compatible campaign columns for existing databases.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS duration_days INT NOT NULL DEFAULT 30;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS audience_mode TEXT NOT NULL DEFAULT 'auto';

CREATE TABLE IF NOT EXISTS domains (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'paused', 'warming')
  ),
  -- Some infrastructure modules expect a paused flag (legacy compatibility).
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  warmup_stage INT NOT NULL DEFAULT 1,
  spf_valid BOOLEAN NOT NULL DEFAULT FALSE,
  dkim_valid BOOLEAN NOT NULL DEFAULT FALSE,
  dmarc_valid BOOLEAN NOT NULL DEFAULT FALSE,
  daily_limit INT NOT NULL DEFAULT 400,
  -- Optional compatibility field used by some analytics/forecast queries.
  -- Kept separate from daily_limit so we can evolve caps without breaking older installs.
  daily_cap INT,
  sent_today INT NOT NULL DEFAULT 0,
  sent_count INT NOT NULL DEFAULT 0,
  bounce_count INT NOT NULL DEFAULT 0,
  health_score NUMERIC(5,2) NOT NULL DEFAULT 100,
  bounce_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  -- Inbox placement signal (0..1). Defaults to 0 for new domains.
  spam_rate NUMERIC(5,4) NOT NULL DEFAULT 0,
  last_reset_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (client_id, domain)
);

-- Backward compatible domain columns for existing databases.
ALTER TABLE domains ADD COLUMN IF NOT EXISTS paused BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS daily_cap INT;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS spam_rate NUMERIC(5,4) NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_domains_spam_rate ON domains(spam_rate DESC);
CREATE INDEX IF NOT EXISTS idx_domains_bounce_rate ON domains(bounce_rate DESC);

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
  -- Idempotency key to prevent duplicate enqueues/sends for the same recipient/campaign/step
  -- (e.g. when multiple contacts share the same email address).
  idempotency_key TEXT,
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

-- Backward compatible: earlier databases may have queue_jobs without idempotency_key.
ALTER TABLE queue_jobs
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

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
  -- Optional compatibility fields used by infrastructure analytics modules.
  -- type mirrors event_type and delivered_at is used for delivery latency reporting.
  type TEXT,
  delivered_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Email validation cache (used by validator-engine and sender-worker pre-send checks).
CREATE TABLE IF NOT EXISTS email_validations (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  normalized_email TEXT NOT NULL,
  domain TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('valid','risky','invalid','unknown')),
  score NUMERIC(3,2) NOT NULL,
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  mx JSONB,
  smtp JSONB,
  catch_all JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_email_validations_normalized ON email_validations(normalized_email);
CREATE INDEX IF NOT EXISTS idx_email_validations_domain ON email_validations(domain);
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

-- Backward compatible columns for existing databases.
ALTER TABLE events ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP;

-- Keep events.type aligned to events.event_type so older analytics queries keep working.
CREATE OR REPLACE FUNCTION xavira_sync_event_type() RETURNS TRIGGER AS $$
BEGIN
  NEW.type := NEW.event_type;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_xavira_sync_event_type ON events;
CREATE TRIGGER trg_xavira_sync_event_type
BEFORE INSERT OR UPDATE OF event_type ON events
FOR EACH ROW
EXECUTE FUNCTION xavira_sync_event_type();

UPDATE events SET type = event_type WHERE type IS NULL;

CREATE TABLE IF NOT EXISTS operator_actions (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  campaign_id BIGINT REFERENCES campaigns(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Domain pause audit events (append-only).
CREATE TABLE IF NOT EXISTS domain_pause_events (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  domain_id BIGINT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  metrics_snapshot JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_domain_pause_events_client_domain_created
  ON domain_pause_events (client_id, domain_id, created_at DESC);

-- Durable adaptive state snapshots (for Redis loss recovery).
CREATE TABLE IF NOT EXISTS adaptive_state_snapshots (
  id BIGSERIAL PRIMARY KEY,
  client_id INT NOT NULL,
  domain_id INT NOT NULL,
  throughput_current NUMERIC,
  cooldown_active BOOLEAN,
  provider_bias JSONB,
  pressure_slow_factor NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adaptive_state_snapshots_client_domain_created
  ON adaptive_state_snapshots (client_id, domain_id, created_at DESC);

CREATE TABLE IF NOT EXISTS provider_health_snapshots (
  id BIGSERIAL PRIMARY KEY,
  client_id INT NOT NULL,
  domain_id BIGINT REFERENCES domains(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  deferral_rate NUMERIC,
  block_rate NUMERIC,
  success_rate NUMERIC,
  throttle_factor NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_health_snapshots_client_provider_created
  ON provider_health_snapshots (client_id, provider, created_at DESC);

ALTER TABLE provider_health_snapshots ADD COLUMN IF NOT EXISTS domain_id BIGINT REFERENCES domains(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_provider_health_snapshots_domain_provider_created
  ON provider_health_snapshots (domain_id, provider, created_at DESC);

-- Seed placement measurements (measurement-only; used to detect inbox placement drift).
CREATE TABLE IF NOT EXISTS seed_placement_events (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('gmail', 'outlook', 'yahoo', 'other')),
  mailbox TEXT NOT NULL,
  message_id TEXT,
  placement TEXT NOT NULL CHECK (placement IN ('inbox', 'spam', 'unknown')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seed_placement_events_client_provider_created
  ON seed_placement_events (client_id, provider, created_at DESC);

-- Durable per-domain/provider reputation state (source of truth; workers also cache in Redis).
CREATE TABLE IF NOT EXISTS reputation_state (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  domain_id BIGINT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('gmail', 'outlook', 'yahoo', 'other')),
  state TEXT NOT NULL CHECK (state IN ('warmup', 'normal', 'degraded', 'cooldown', 'paused')),
  max_per_hour INT NOT NULL DEFAULT 50,
  max_per_minute INT NOT NULL DEFAULT 2,
  max_concurrency INT NOT NULL DEFAULT 2,
  cooldown_until TIMESTAMPTZ,
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  metrics_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (client_id, domain_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_reputation_state_client_domain_provider
  ON reputation_state (client_id, domain_id, provider);

ALTER TABLE reputation_state ADD COLUMN IF NOT EXISTS max_per_hour INT NOT NULL DEFAULT 50;

-- Append-only throttle/pause/ramp audit trail for the UI and compliance review.
CREATE TABLE IF NOT EXISTS reputation_events (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  domain_id BIGINT REFERENCES domains(id) ON DELETE CASCADE,
  provider TEXT CHECK (provider IN ('gmail', 'outlook', 'yahoo', 'other')),
  event_type TEXT NOT NULL CHECK (
    event_type IN ('ramp', 'throttle', 'pause', 'resume', 'cooldown', 'measurement')
  ),
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  message TEXT NOT NULL,
  previous_state JSONB,
  next_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  metrics_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reputation_events_client_created
  ON reputation_events (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reputation_events_domain_provider_created
  ON reputation_events (domain_id, provider, created_at DESC);

-- Public Reputation-as-a-Service API keys.
-- Store only SHA-256 hashes of raw API keys; never persist plaintext keys.
CREATE TABLE IF NOT EXISTS public_api_keys (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT REFERENCES clients(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'enterprise')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'revoked')),
  daily_limit INT,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_public_api_keys_hash_active
  ON public_api_keys (key_hash)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_public_api_keys_client
  ON public_api_keys (client_id, created_at DESC);

-- AES-256-GCM encrypted secret vault.
-- Stores retrievable secrets only when SECRET_MASTER_KEY/SECRET_MASTER_KEYS is configured.
CREATE TABLE IF NOT EXISTS encrypted_secrets (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT REFERENCES clients(id) ON DELETE CASCADE,
  secret_type TEXT NOT NULL CHECK (
    secret_type IN ('smtp_credential', 'api_key', 'webhook_secret', 'integration_token')
  ),
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  key_version TEXT NOT NULL,
  algorithm TEXT NOT NULL DEFAULT 'aes-256-gcm',
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'rotated', 'revoked')),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  UNIQUE (client_id, secret_type, resource_type, resource_id, status)
);

CREATE INDEX IF NOT EXISTS idx_encrypted_secrets_lookup
  ON encrypted_secrets (client_id, secret_type, resource_type, resource_id, created_at DESC)
  WHERE status = 'active';

-- Billable Reputation API usage ledger.
CREATE TABLE IF NOT EXISTS reputation_api_logs (
  id BIGSERIAL PRIMARY KEY,
  api_key_id BIGINT REFERENCES public_api_keys(id) ON DELETE SET NULL,
  client_id BIGINT REFERENCES clients(id) ON DELETE SET NULL,
  domain TEXT,
  ip TEXT,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_status INT NOT NULL,
  reputation_score INT,
  tier TEXT NOT NULL DEFAULT 'free',
  billable_units INT NOT NULL DEFAULT 1,
  cache_hit BOOLEAN NOT NULL DEFAULT false,
  latency_ms INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reputation_api_logs_key_created
  ON reputation_api_logs (api_key_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reputation_api_logs_domain_created
  ON reputation_api_logs (domain, created_at DESC);

-- Sensitive data guardrails for audit/reputation logs.
-- Keep operational logs useful while preventing recipient emails, tokens, and SMTP secrets from being persisted.
CREATE OR REPLACE FUNCTION xavira_mask_text(input TEXT) RETURNS TEXT AS $$
BEGIN
  IF input IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN regexp_replace(
    input,
    '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}',
    '[email-redacted]',
    'gi'
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION xavira_mask_jsonb(input JSONB) RETURNS JSONB AS $$
DECLARE
  output JSONB;
BEGIN
  IF input IS NULL THEN
    RETURN NULL;
  END IF;

  IF jsonb_typeof(input) = 'object' THEN
    SELECT jsonb_object_agg(
      key,
      CASE
        WHEN lower(key) ~ '(password|pass|secret|token|smtp|authorization|cookie|api[_-]?key)' THEN to_jsonb('[redacted]'::text)
        WHEN lower(key) ~ '(^email$|_email$|email_|recipient|to$|from$)' THEN to_jsonb('[email-redacted]'::text)
        ELSE xavira_mask_jsonb(value)
      END
    )
    INTO output
    FROM jsonb_each(input);
    RETURN COALESCE(output, '{}'::jsonb);
  END IF;

  IF jsonb_typeof(input) = 'array' THEN
    SELECT jsonb_agg(xavira_mask_jsonb(value))
    INTO output
    FROM jsonb_array_elements(input);
    RETURN COALESCE(output, '[]'::jsonb);
  END IF;

  IF jsonb_typeof(input) = 'string' THEN
    RETURN to_jsonb(xavira_mask_text(input #>> '{}'));
  END IF;

  RETURN input;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION xavira_mask_reputation_event() RETURNS TRIGGER AS $$
BEGIN
  NEW.message := xavira_mask_text(NEW.message);
  NEW.previous_state := xavira_mask_jsonb(NEW.previous_state);
  NEW.next_state := COALESCE(xavira_mask_jsonb(NEW.next_state), '{}'::jsonb);
  NEW.metrics_snapshot := COALESCE(xavira_mask_jsonb(NEW.metrics_snapshot), '{}'::jsonb);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_xavira_mask_reputation_event ON reputation_events;
CREATE TRIGGER trg_xavira_mask_reputation_event
BEFORE INSERT OR UPDATE ON reputation_events
FOR EACH ROW
EXECUTE FUNCTION xavira_mask_reputation_event();

-- Autonomous Copilot memory + approval ledger.
CREATE TABLE IF NOT EXISTS copilot_memory (
  id TEXT PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('global', 'client', 'campaign', 'domain')),
  scope_key TEXT,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_copilot_memory_client_created
  ON copilot_memory (client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS copilot_proposals (
  id TEXT PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'executed', 'cancelled')),
  summary TEXT NOT NULL,
  proposed_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  confirmed_at TIMESTAMP,
  executed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_copilot_proposals_client_created
  ON copilot_proposals (client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS copilot_settings (
  client_id BIGINT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  autonomous_mode BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS copilot_action_impacts (
  id TEXT PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  action_kind TEXT NOT NULL,
  action_summary TEXT NOT NULL,
  action_payload JSONB,
  before_snapshot JSONB NOT NULL,
  after_snapshot JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_copilot_action_impacts_client_created
  ON copilot_action_impacts (client_id, created_at DESC);

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

-- Backward compatible column: required for idempotency indexes below.
ALTER TABLE queue_jobs
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE INDEX IF NOT EXISTS idx_queue_jobs_client_status
  ON queue_jobs (client_id, status);
CREATE INDEX IF NOT EXISTS idx_queue_jobs_campaign_status
  ON queue_jobs (campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_queue_jobs_scheduled
  ON queue_jobs (scheduled_at);
CREATE INDEX IF NOT EXISTS idx_queue_jobs_recipient_email
  ON queue_jobs (recipient_email);

-- Enterprise-grade idempotency: one decision -> one enqueue -> one send.
-- The key includes recipient + campaign + sequence_step (hash computed in app code/SQL).
CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_jobs_idempotency
  ON queue_jobs (client_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_client_created
  ON events (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_campaign
  ON events (campaign_id);
CREATE INDEX IF NOT EXISTS idx_events_type
  ON events (event_type);

-- Tracking idempotency: dedupe by stable event id stored in metadata.event_id.
-- This protects downstream attribution/metrics from duplicates on retries.
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_event_id
  ON events (client_id, (metadata->>'event_id'))
  WHERE metadata ? 'event_id';
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
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE contacts
SET email_domain = LOWER(SPLIT_PART(email, '@', 2))
WHERE email_domain IS NULL;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS email_validation_score NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS email_validated_at TIMESTAMP;

ALTER TABLE queue_jobs
  ADD COLUMN IF NOT EXISTS sequence_stopped BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ab_variant TEXT,
  ADD COLUMN IF NOT EXISTS ab_assignment_id TEXT,
  ADD COLUMN IF NOT EXISTS dead_letter_reason TEXT;

ALTER TABLE identities
  ADD COLUMN IF NOT EXISTS reputation_score NUMERIC(5,2) NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS consecutive_failures INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS circuit_breaker_until TIMESTAMP;

ALTER TABLE domains
  ADD COLUMN IF NOT EXISTS reputation_score NUMERIC(5,2) NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS consecutive_failures INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS circuit_breaker_until TIMESTAMP,
  ADD COLUMN IF NOT EXISTS warmup_ramp_percent INT NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS warmup_last_increased_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS email_threads (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contact_id BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  campaign_id BIGINT REFERENCES campaigns(id) ON DELETE SET NULL,
  thread_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  message_count INT NOT NULL DEFAULT 1,
  last_message_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (client_id, thread_id)
);

CREATE TABLE IF NOT EXISTS system_metrics (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  metric_name TEXT NOT NULL,
  metric_value NUMERIC NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS alerts (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  message TEXT NOT NULL,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Role Management System Tables
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  subscription JSONB NOT NULL DEFAULT '{}'::jsonb,
  owner_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS organization_id TEXT,
  ADD COLUMN IF NOT EXISTS role_id TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS suspended_reason TEXT,
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS suspended_by TEXT,
  ADD COLUMN IF NOT EXISTS last_login TIMESTAMP,
  ADD COLUMN IF NOT EXISTS created_by TEXT;

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  organization_id TEXT, -- NULL for system roles
  is_system_role BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  added_by TEXT NOT NULL,
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS access_control (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  granted_by TEXT NOT NULL,
  granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP,
  PRIMARY KEY (user_id, resource_type, resource_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id BIGINT,
  client_id BIGINT REFERENCES clients(id) ON DELETE SET NULL,
  actor_id TEXT,
  actor_type TEXT NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user', 'system', 'api_key', 'anonymous')),
  action TEXT NOT NULL,
  action_type TEXT,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address TEXT,
  user_agent TEXT,
  timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  timestamp_utc TIMESTAMPTZ NOT NULL DEFAULT now(),
  previous_hash TEXT,
  entry_hash TEXT UNIQUE,
  request_id TEXT,
  service_name TEXT NOT NULL DEFAULT 'api-gateway'
);

ALTER TABLE audit_logs
  ALTER COLUMN user_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS client_id BIGINT REFERENCES clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS actor_id TEXT,
  ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS action_type TEXT,
  ADD COLUMN IF NOT EXISTS timestamp_utc TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS previous_hash TEXT,
  ADD COLUMN IF NOT EXISTS entry_hash TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS request_id TEXT,
  ADD COLUMN IF NOT EXISTS service_name TEXT NOT NULL DEFAULT 'api-gateway';

UPDATE audit_logs
SET
  actor_id = COALESCE(actor_id, user_id::TEXT, 'system'),
  action_type = COALESCE(action_type, action),
  timestamp_utc = COALESCE(timestamp_utc, timestamp::timestamptz)
WHERE actor_id IS NULL
   OR action_type IS NULL;

CREATE OR REPLACE FUNCTION xavira_mask_audit_log() RETURNS TRIGGER AS $$
BEGIN
  NEW.details := COALESCE(xavira_mask_jsonb(NEW.details), '{}'::jsonb);
  NEW.actor_id := COALESCE(NEW.actor_id, NEW.user_id::TEXT, 'system');
  NEW.action_type := COALESCE(NEW.action_type, NEW.action);
  NEW.timestamp_utc := COALESCE(NEW.timestamp_utc, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_xavira_mask_audit_log ON audit_logs;
CREATE TRIGGER trg_xavira_mask_audit_log
BEFORE INSERT ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION xavira_mask_audit_log();

CREATE OR REPLACE FUNCTION xavira_reject_audit_log_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs are immutable; append a new audit event instead';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_xavira_audit_logs_immutable_update ON audit_logs;
CREATE TRIGGER trg_xavira_audit_logs_immutable_update
BEFORE UPDATE ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION xavira_reject_audit_log_mutation();

DROP TRIGGER IF EXISTS trg_xavira_audit_logs_immutable_delete ON audit_logs;
CREATE TRIGGER trg_xavira_audit_logs_immutable_delete
BEFORE DELETE ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION xavira_reject_audit_log_mutation();

CREATE INDEX IF NOT EXISTS idx_audit_logs_client_timestamp_utc
  ON audit_logs(client_id, timestamp_utc DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entry_hash
  ON audit_logs(entry_hash)
  WHERE entry_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS session_revocations (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT REFERENCES clients(id) ON DELETE CASCADE,
  revoked_after TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_revocations_client_created
  ON session_revocations (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_session_revocations_global_created
  ON session_revocations (created_at DESC)
  WHERE client_id IS NULL;

-- Decision Audit Log (append-only)
-- Stores explainable decisions tied to traceId for audit + attribution.
CREATE TABLE IF NOT EXISTS decision_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  campaign_id BIGINT REFERENCES campaigns(id) ON DELETE SET NULL,
  queue_job_id BIGINT REFERENCES queue_jobs(id) ON DELETE SET NULL,
  idempotency_key TEXT,
  trace_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  signals JSONB NOT NULL DEFAULT '{}'::jsonb,
  outcome_group TEXT,
  priority_score NUMERIC(8,4),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE decision_audit_logs
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE INDEX IF NOT EXISTS idx_decision_audit_client_trace
  ON decision_audit_logs (client_id, trace_id);
CREATE INDEX IF NOT EXISTS idx_decision_audit_campaign
  ON decision_audit_logs (client_id, campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decision_audit_queue_job
  ON decision_audit_logs (client_id, queue_job_id);

-- Ensure duplicates never create multiple audit rows for the same send-unit.
CREATE UNIQUE INDEX IF NOT EXISTS idx_decision_audit_idempotency
  ON decision_audit_logs (client_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- API Management Tables
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_used TIMESTAMP,
  expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_requests (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  organization_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  status_code INT NOT NULL,
  response_time INT, -- milliseconds
  timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Notification System Tables
CREATE TABLE IF NOT EXISTS notification_channels (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('email', 'slack', 'webhook', 'sms')),
  name TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notification_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  event_type TEXT NOT NULL,
  conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  channels JSONB NOT NULL DEFAULT '[]'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  cooldown_minutes INT NOT NULL DEFAULT 60,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notification_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT,
  campaign_id TEXT,
  sequence_id TEXT,
  contact_id TEXT,
  timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent BOOLEAN NOT NULL DEFAULT FALSE,
  sent_at TIMESTAMP,
  error TEXT
);

CREATE TABLE IF NOT EXISTS notification_history (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'pending')),
  sent_at TIMESTAMP,
  error TEXT,
  response JSONB
);

-- Delivery Optimization Tables
CREATE TABLE IF NOT EXISTS delivery_configs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS delivery_domain_configs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  domain_id TEXT NOT NULL,
  priority INT NOT NULL DEFAULT 1,
  max_hourly_sends INT NOT NULL DEFAULT 1000,
  health_score DECIMAL(3,2) NOT NULL DEFAULT 1.0,
  last_health_check TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  consecutive_failures INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, domain_id)
);

CREATE TABLE IF NOT EXISTS delivery_ip_configs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ip TEXT NOT NULL,
  provider TEXT NOT NULL,
  reputation DECIMAL(3,2) NOT NULL DEFAULT 1.0,
  last_health_check TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  consecutive_failures INT NOT NULL DEFAULT 0,
  daily_send_limit INT NOT NULL DEFAULT 50000,
  current_day_sends INT NOT NULL DEFAULT 0,
  day_reset TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, ip)
);

CREATE TABLE IF NOT EXISTS delivery_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  domain TEXT NOT NULL,
  ip TEXT,
  campaign_id TEXT,
  sequence_id TEXT,
  result TEXT NOT NULL CHECK (result IN ('delivered', 'bounced', 'complained', 'unsubscribed')),
  timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Guaranteed Output Engine Tables
CREATE TABLE IF NOT EXISTS output_engine_configs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS queued_emails (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_id TEXT,
  sequence_id TEXT,
  contact_id TEXT NOT NULL,
  email_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('critical', 'high', 'normal', 'low')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'sent', 'failed', 'retry')),
  retry_count INT NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMP,
  processing_at TIMESTAMP,
  sent_at TIMESTAMP,
  failure_reason TEXT,
  expires_at TIMESTAMP,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_organization ON users(organization_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_teams_organization ON teams(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_api_keys_organization ON api_keys(organization_id);
CREATE INDEX IF NOT EXISTS idx_api_requests_user ON api_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_api_requests_timestamp ON api_requests(timestamp);
CREATE INDEX IF NOT EXISTS idx_notification_events_org ON notification_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_notification_events_timestamp ON notification_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_delivery_events_org ON delivery_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_delivery_events_timestamp ON delivery_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_queued_emails_org ON queued_emails(organization_id);
CREATE INDEX IF NOT EXISTS idx_queued_emails_status ON queued_emails(status);
CREATE INDEX IF NOT EXISTS idx_queued_emails_priority ON queued_emails(priority);
CREATE INDEX IF NOT EXISTS idx_queued_emails_created ON queued_emails(created_at);

-- AI Integration Tables
CREATE TABLE IF NOT EXISTS ai_models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  cost_per_token DECIMAL(10,8) NOT NULL,
  max_tokens INT NOT NULL,
  capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  priority INT NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_requests (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_length INT NOT NULL,
  tokens_used INT NOT NULL DEFAULT 0,
  cost DECIMAL(10,4) NOT NULL DEFAULT 0,
  success BOOLEAN NOT NULL DEFAULT FALSE,
  error TEXT,
  cached BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for AI tables
CREATE INDEX IF NOT EXISTS idx_ai_requests_task ON ai_requests(task);
CREATE INDEX IF NOT EXISTS idx_ai_requests_model ON ai_requests(model);
CREATE INDEX IF NOT EXISTS idx_ai_requests_created ON ai_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_models_active ON ai_models(active, priority DESC);

-- Scraping Tables
CREATE TABLE IF NOT EXISTS scraping_requests (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('company', 'person', 'contact_page', 'linkedin', 'general')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  anti_detection BOOLEAN NOT NULL DEFAULT TRUE,
  max_depth INT DEFAULT 1,
  selectors JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  duration_ms INT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS scraped_contacts (
  id TEXT PRIMARY KEY,
  scraping_request_id TEXT REFERENCES scraping_requests(id) ON DELETE CASCADE,
  emails JSONB NOT NULL DEFAULT '[]'::jsonb,
  phone_numbers JSONB NOT NULL DEFAULT '[]'::jsonb,
  addresses JSONB NOT NULL DEFAULT '[]'::jsonb,
  social_profiles JSONB NOT NULL DEFAULT '{}'::jsonb,
  job_title TEXT,
  company TEXT,
  website TEXT,
  bio TEXT,
  location TEXT,
  industry TEXT,
  company_size TEXT,
  revenue TEXT,
  technologies JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence DECIMAL(3,2) NOT NULL DEFAULT 0,
  source_url TEXT NOT NULL,
  scraped_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for scraping tables
CREATE INDEX IF NOT EXISTS idx_scraping_requests_status ON scraping_requests(status);
CREATE INDEX IF NOT EXISTS idx_scraping_requests_created ON scraping_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_scraped_contacts_company ON scraped_contacts(company);
CREATE INDEX IF NOT EXISTS idx_scraped_contacts_confidence ON scraped_contacts(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_scraped_contacts_scraped_at ON scraped_contacts(scraped_at);

-- Advanced AI Pro Database Schema Extensions

-- Autonomous Campaigns Table
CREATE TABLE IF NOT EXISTS autonomous_campaigns (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'learning', -- learning, optimizing, peaking, declining
  config JSONB,
  performance JSONB DEFAULT '{}',
  optimizations JSONB DEFAULT '{}',
  next_actions JSONB DEFAULT '[]',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Optimization Actions Log
CREATE TABLE IF NOT EXISTS optimization_actions (
  id SERIAL PRIMARY KEY,
  campaign_id VARCHAR(255) NOT NULL REFERENCES autonomous_campaigns(id) ON DELETE CASCADE,
  action_type VARCHAR(100) NOT NULL,
  action_data JSONB,
  executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  result VARCHAR(50) DEFAULT 'pending', -- pending, success, failed
  error TEXT,
  predicted_impact DECIMAL(3,2)
);

-- Campaign Metrics for Optimization
CREATE TABLE IF NOT EXISTS campaign_metrics (
  id SERIAL PRIMARY KEY,
  campaign_id VARCHAR(255) NOT NULL,
  open_rate DECIMAL(5,4),
  click_rate DECIMAL(5,4),
  reply_rate DECIMAL(5,4),
  bounce_rate DECIMAL(5,4),
  unsubscribe_rate DECIMAL(5,4),
  spam_complaints INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  revenue DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- A/B Tests Table
CREATE TABLE IF NOT EXISTS ab_tests (
  id SERIAL PRIMARY KEY,
  campaign_id VARCHAR(255) NOT NULL,
  test_type VARCHAR(100) NOT NULL, -- subject_line, content, send_time, etc.
  variations JSONB NOT NULL,
  winner VARCHAR(255),
  confidence DECIMAL(3,2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Contact Segments for Personalization
CREATE TABLE IF NOT EXISTS contact_segments (
  id SERIAL PRIMARY KEY,
  campaign_id VARCHAR(255) NOT NULL,
  segment_name VARCHAR(255) NOT NULL,
  criteria JSONB NOT NULL,
  contact_count INTEGER DEFAULT 0,
  performance JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- AI Predictions Cache
CREATE TABLE IF NOT EXISTS ai_predictions (
  id SERIAL PRIMARY KEY,
  prediction_type VARCHAR(100) NOT NULL, -- performance, personalization, conversion
  input_hash VARCHAR(255) UNIQUE NOT NULL,
  input_data JSONB NOT NULL,
  prediction JSONB NOT NULL,
  confidence DECIMAL(3,2),
  actual_result JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  validated_at TIMESTAMP WITH TIME ZONE
);

-- Competitive Intelligence Cache
CREATE TABLE IF NOT EXISTS competitive_intelligence (
  id SERIAL PRIMARY KEY,
  industry VARCHAR(255) NOT NULL,
  target_market VARCHAR(255),
  strategy_hash VARCHAR(255) UNIQUE NOT NULL,
  intelligence_data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '30 days')
);

-- Voice Commands Log
CREATE TABLE IF NOT EXISTS voice_commands (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255),
  command TEXT NOT NULL,
  response TEXT,
  confidence DECIMAL(3,2),
  executed_action VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for Performance
CREATE INDEX IF NOT EXISTS idx_autonomous_campaigns_status ON autonomous_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_optimization_actions_campaign ON optimization_actions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_metrics_campaign ON campaign_metrics(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_metrics_created ON campaign_metrics(created_at);
CREATE INDEX IF NOT EXISTS idx_ab_tests_campaign ON ab_tests(campaign_id);
CREATE INDEX IF NOT EXISTS idx_contact_segments_campaign ON contact_segments(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ai_predictions_type ON ai_predictions(prediction_type);
CREATE INDEX IF NOT EXISTS idx_ai_predictions_hash ON ai_predictions(input_hash);
CREATE INDEX IF NOT EXISTS idx_competitive_intelligence_expires ON competitive_intelligence(expires_at);

-- Update existing tables to support new features
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS autonomous_mode BOOLEAN DEFAULT false;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS optimization_status VARCHAR(50) DEFAULT 'manual';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS ai_predictions JSONB DEFAULT '{}';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS performance_trend VARCHAR(20) DEFAULT 'stable';

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ai_score DECIMAL(3,2);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS conversion_probability DECIMAL(3,2);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS personalization_profile JSONB DEFAULT '{}';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS segment_tags TEXT[];

-- Insert sample data for testing
INSERT INTO autonomous_campaigns (id, name, status, config) 
VALUES ('demo-campaign-1', 'Demo Autonomous Campaign', 'learning', '{"industry": "technology", "target_audience": "developers"}')
ON CONFLICT (id) DO NOTHING;
