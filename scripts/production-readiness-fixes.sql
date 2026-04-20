-- PRODUCTION READINESS FIXES
-- Critical fixes for 50K+ emails/day cold email platform

-- 1. IDEMPOTENCY KEYS - Add to queue jobs
ALTER TABLE queue_jobs ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE;

-- 2. CIRCUIT BREAKERS - Add failure tracking
ALTER TABLE identities ADD COLUMN IF NOT EXISTS consecutive_failures INT DEFAULT 0;
ALTER TABLE identities ADD COLUMN IF NOT EXISTS circuit_breaker_until TIMESTAMP;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS consecutive_failures INT DEFAULT 0;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS circuit_breaker_until TIMESTAMP;

-- 3. DEAD LETTER QUEUE - Add dead letter status
ALTER TABLE queue_jobs ADD COLUMN IF NOT EXISTS dead_letter_reason TEXT;
ALTER TABLE queue_jobs DROP CONSTRAINT IF EXISTS queue_jobs_status_check;
ALTER TABLE queue_jobs ADD CONSTRAINT queue_jobs_status_check CHECK (
  status IN ('pending', 'processing', 'retry', 'completed', 'failed', 'skipped', 'dead_letter')
);

-- 4. EMAIL VALIDATION - Add pre-send validation
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email_validated_at TIMESTAMP;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email_validation_score NUMERIC(3,2);

-- 5. SEQUENCE STOP-ON-REPLY - Add reply tracking
ALTER TABLE queue_jobs ADD COLUMN IF NOT EXISTS sequence_stopped BOOLEAN DEFAULT FALSE;

-- 6. A/B ASSIGNMENT - Add variant tracking
ALTER TABLE queue_jobs ADD COLUMN IF NOT EXISTS ab_variant TEXT;
ALTER TABLE queue_jobs ADD COLUMN IF NOT EXISTS ab_assignment_id TEXT;

-- 7. THREAD STORAGE - Add conversation linking
CREATE TABLE IF NOT EXISTS email_threads (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contact_id BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  campaign_id BIGINT REFERENCES campaigns(id) ON DELETE SET NULL,
  thread_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  message_count INT DEFAULT 1,
  last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (client_id, thread_id)
);

-- 8. AUDIT TRAILS - Enhanced events
ALTER TABLE events ADD COLUMN IF NOT EXISTS correlation_id TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS ip_address INET;

-- 9. DOMAIN WARMUP - Add warmup tracking
ALTER TABLE domains ADD COLUMN IF NOT EXISTS warmup_ramp_percent INT DEFAULT 100;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS warmup_last_increased_at TIMESTAMP;

-- 10. HEALTH SCORING - Enhanced metrics
ALTER TABLE domains ADD COLUMN IF NOT EXISTS reputation_score NUMERIC(5,2) DEFAULT 100;
ALTER TABLE identities ADD COLUMN IF NOT EXISTS reputation_score NUMERIC(5,2) DEFAULT 100;

-- 11. AI VALIDATION - Add response validation
ALTER TABLE queue_jobs ADD COLUMN IF NOT EXISTS ai_validation_passed BOOLEAN DEFAULT TRUE;
ALTER TABLE queue_jobs ADD COLUMN IF NOT EXISTS ai_fallback_used BOOLEAN DEFAULT FALSE;

-- 12. COMPLIANCE - Enhanced suppression
ALTER TABLE suppression_list ADD COLUMN IF NOT EXISTS global_suppression BOOLEAN DEFAULT TRUE;
ALTER TABLE suppression_list ADD COLUMN IF NOT EXISTS region_blocked TEXT[];

-- 13. METRICS - Add metrics tables
CREATE TABLE IF NOT EXISTS system_metrics (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT REFERENCES clients(id) ON DELETE CASCADE,
  metric_name TEXT NOT NULL,
  metric_value NUMERIC NOT NULL,
  timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB
);

CREATE TABLE IF NOT EXISTS alerts (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT REFERENCES clients(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  message TEXT NOT NULL,
  resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 14. INDEXES - Performance optimization
CREATE INDEX IF NOT EXISTS idx_queue_jobs_idempotency ON queue_jobs(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_queue_jobs_sequence_stop ON queue_jobs(sequence_stopped) WHERE sequence_stopped = FALSE;
CREATE INDEX IF NOT EXISTS idx_contacts_email_validated ON contacts(email_validated_at);
CREATE INDEX IF NOT EXISTS idx_events_correlation ON events(correlation_id);
CREATE INDEX IF NOT EXISTS idx_email_threads_contact ON email_threads(client_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_system_metrics_client_time ON system_metrics(client_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_client_unresolved ON alerts(client_id, resolved) WHERE resolved = FALSE;
