CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tenant_licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  license_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  seats INT NOT NULL DEFAULT 3,
  child_tenant_limit INT NOT NULL DEFAULT 0,
  api_monthly_limit INT NOT NULL DEFAULT 10000,
  ingestion_monthly_limit INT NOT NULL DEFAULT 25000,
  send_monthly_limit INT NOT NULL DEFAULT 5000,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  commercial_terms JSONB NOT NULL DEFAULT '{}'::jsonb,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  renews_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, license_type)
);

CREATE TABLE IF NOT EXISTS source_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  auth_type TEXT NOT NULL DEFAULT 'none',
  encrypted_secret_id BIGINT REFERENCES encrypted_secrets(id) ON DELETE SET NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  cursor_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  rate_limit_per_minute INT NOT NULL DEFAULT 60,
  source_trust NUMERIC(4,3) NOT NULL DEFAULT 0.700,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, source_type, name)
);

CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  source_connection_id UUID REFERENCES source_connections(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  idempotency_key TEXT NOT NULL,
  requested_by TEXT NOT NULL DEFAULT 'system',
  input_ref TEXT,
  total_records INT NOT NULL DEFAULT 0,
  accepted_records INT NOT NULL DEFAULT 0,
  rejected_records INT NOT NULL DEFAULT 0,
  enriched_records INT NOT NULL DEFAULT 0,
  failure_count INT NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS operational_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_version INT NOT NULL DEFAULT 1,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  actor_type TEXT NOT NULL DEFAULT 'system',
  actor_id TEXT,
  idempotency_key TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_lanes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  lane TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  max_per_minute INT NOT NULL DEFAULT 1,
  max_per_hour INT NOT NULL DEFAULT 20,
  max_per_day INT NOT NULL DEFAULT 100,
  throttle_factor NUMERIC(5,4) NOT NULL DEFAULT 1.0000,
  emergency_brake_active BOOLEAN NOT NULL DEFAULT FALSE,
  bounce_rate_24h NUMERIC(5,4) NOT NULL DEFAULT 0,
  failure_rate_24h NUMERIC(5,4) NOT NULL DEFAULT 0,
  reply_rate_7d NUMERIC(5,4) NOT NULL DEFAULT 0,
  telemetry JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, provider, lane)
);

CREATE TABLE IF NOT EXISTS conversation_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contact_id BIGINT REFERENCES contacts(id) ON DELETE SET NULL,
  message_id TEXT,
  from_email TEXT NOT NULL,
  subject TEXT,
  classification TEXT NOT NULL DEFAULT 'unknown',
  sentiment TEXT NOT NULL DEFAULT 'neutral',
  objection_type TEXT,
  opportunity_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  recommended_action TEXT NOT NULL DEFAULT 'review',
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_source_connections_client_status
  ON source_connections (client_id, status, source_type);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_client_status_created
  ON ingestion_jobs (client_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_operational_events_idempotency
  ON operational_events (client_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_operational_events_client_created
  ON operational_events (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_lanes_client_status
  ON provider_lanes (client_id, status, provider);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_intelligence_message
  ON conversation_intelligence (client_id, message_id)
  WHERE message_id IS NOT NULL;
