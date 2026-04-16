-- Create domains table
CREATE TABLE IF NOT EXISTS domains (
  id BIGSERIAL PRIMARY KEY,
  domain VARCHAR(255) UNIQUE NOT NULL,
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'paused', 'warming')),
  warmup_stage INT DEFAULT 0,
  daily_limit INT DEFAULT 50,
  sent_today INT DEFAULT 0,
  health_score FLOAT DEFAULT 100.0,
  bounce_rate FLOAT DEFAULT 0.0,
  reply_rate FLOAT DEFAULT 0.0,
  last_reset_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create identities (email addresses per domain)
CREATE TABLE IF NOT EXISTS identities (
  id BIGSERIAL PRIMARY KEY,
  domain_id BIGINT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  daily_limit INT DEFAULT 50,
  sent_today INT DEFAULT 0,
  last_sent_at TIMESTAMP,
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'paused', 'inactive')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(domain_id, email)
);

-- Create events table for tracking sends, bounces, replies
CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  identity_id BIGINT NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL CHECK (type IN ('sent', 'bounce', 'reply', 'complaint')),
  contact_email VARCHAR(255),
  campaign_id BIGINT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create queue table for job persistence
CREATE TABLE IF NOT EXISTS queue (
  id BIGSERIAL PRIMARY KEY,
  contact_id BIGINT NOT NULL,
  campaign_id BIGINT NOT NULL,
  domain_id BIGINT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMP,
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempt_count INT DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_domains_status ON domains(status);
CREATE INDEX IF NOT EXISTS idx_domains_created_at ON domains(created_at);
CREATE INDEX IF NOT EXISTS idx_identities_domain_id ON identities(domain_id);
CREATE INDEX IF NOT EXISTS idx_identities_status ON identities(status);
CREATE INDEX IF NOT EXISTS idx_events_identity_id ON events(identity_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_queue_status ON queue(status);
CREATE INDEX IF NOT EXISTS idx_queue_domain_id ON queue(domain_id);
CREATE INDEX IF NOT EXISTS idx_queue_scheduled_at ON queue(scheduled_at);
