/**
 * DATABASE MIGRATION: INFRASTRUCTURE SYSTEM
 *
 * Run this migration to set up the autonomous infrastructure system
 *
 * Execute with: psql -U <user> -d <database> -f infrastructure-migration.sql
 */

-- ============================================================
-- Create domains table (if not exists)
-- ============================================================

CREATE TABLE IF NOT EXISTS domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain VARCHAR(255) UNIQUE NOT NULL,
  status VARCHAR(50) DEFAULT 'active',
  bounce_rate DECIMAL(5,4) DEFAULT 0,
  spam_rate DECIMAL(5,4) DEFAULT 0,
  warmup_stage INT DEFAULT 1,
  paused_until TIMESTAMP DEFAULT NULL,
  api_token_expires_at TIMESTAMP DEFAULT NULL,
  sending_throttle DECIMAL(3,2) DEFAULT 1.0,
  capacity_per_day INT DEFAULT 200,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_domains_status ON domains(status);
CREATE INDEX IF NOT EXISTS idx_domains_bounce_rate ON domains(bounce_rate DESC);
CREATE INDEX IF NOT EXISTS idx_domains_spam_rate ON domains(spam_rate DESC);
CREATE INDEX IF NOT EXISTS idx_domains_created_at ON domains(created_at DESC);

-- ============================================================
-- Update identities table
-- ============================================================

ALTER TABLE identities
ADD COLUMN IF NOT EXISTS unavailable_until TIMESTAMP DEFAULT NULL,
ADD COLUMN IF NOT EXISTS sending_throttle DECIMAL(3,2) DEFAULT 1.0,
ADD COLUMN IF NOT EXISTS last_failure_at TIMESTAMP DEFAULT NULL,
ADD COLUMN IF NOT EXISTS failure_count_24h INT DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_identities_unavailable_until 
ON identities(unavailable_until) WHERE unavailable_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_identities_status 
ON identities(status);

-- ============================================================
-- Create infrastructure events table
-- ============================================================

CREATE TABLE IF NOT EXISTS infrastructure_events (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  domain_id UUID REFERENCES domains(id) ON DELETE SET NULL,
  inbox_id UUID REFERENCES identities(id) ON DELETE SET NULL,
  details JSONB DEFAULT NULL,
  severity VARCHAR(50) DEFAULT 'info',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_infrastructure_events_created_at 
ON infrastructure_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_infrastructure_events_domain_id 
ON infrastructure_events(domain_id);

CREATE INDEX IF NOT EXISTS idx_infrastructure_events_inbox_id 
ON infrastructure_events(inbox_id);

CREATE INDEX IF NOT EXISTS idx_infrastructure_events_event_type 
ON infrastructure_events(event_type);

CREATE INDEX IF NOT EXISTS idx_infrastructure_events_severity 
ON infrastructure_events(severity);

-- ============================================================
-- Create infrastructure metrics table
-- ============================================================

CREATE TABLE IF NOT EXISTS infrastructure_metrics (
  id SERIAL PRIMARY KEY,
  metric_type VARCHAR(100) NOT NULL,
  value DECIMAL(10,2),
  domain_id UUID REFERENCES domains(id) ON DELETE SET NULL,
  details JSONB DEFAULT NULL,
  recorded_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_infrastructure_metrics_recorded_at 
ON infrastructure_metrics(recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_infrastructure_metrics_metric_type 
ON infrastructure_metrics(metric_type);

CREATE INDEX IF NOT EXISTS idx_infrastructure_metrics_domain_id 
ON infrastructure_metrics(domain_id);

-- ============================================================
-- Create infrastructure configuration table
-- ============================================================

CREATE TABLE IF NOT EXISTS infrastructure_config (
  id SERIAL PRIMARY KEY,
  config_key VARCHAR(100) UNIQUE NOT NULL,
  config_value VARCHAR(500),
  config_type VARCHAR(50),
  description TEXT,
  updated_at TIMESTAMP DEFAULT NOW(),
  updated_by VARCHAR(100)
);

INSERT INTO infrastructure_config (config_key, config_value, config_type, description)
VALUES
  ('max_emails_per_inbox', '50', 'number', 'Maximum emails per inbox per day'),
  ('inboxes_per_domain', '4', 'number', 'Number of inboxes to create per domain'),
  ('max_bounce_rate', '0.05', 'decimal', 'Max bounce rate before pausing (5%)'),
  ('max_spam_rate', '0.02', 'decimal', 'Max spam rate before pausing (2%)'),
  ('domain_pause_duration_hours', '24', 'number', 'Hours to pause domain after hitting limits'),
  ('inbox_temp_unavailable_duration_min', '30', 'number', 'Minutes to mark inbox unavailable after failure'),
  ('health_check_interval_sec', '300', 'number', 'Health check interval in seconds (5 min)'),
  ('optimization_interval_sec', '3600', 'number', 'Optimization interval in seconds (1 hour)'),
  ('capacity_scaling_buffer_percent', '30', 'number', 'Extra capacity buffer when scaling (30%)'),
  ('auto_scaling_enabled', 'true', 'boolean', 'Enable automatic domain provisioning'),
  ('auto_healing_enabled', 'true', 'boolean', 'Enable automatic issue fixing'),
  ('learning_enabled', 'true', 'boolean', 'Enable pattern learning and optimization'),
  ('failover_enabled', 'true', 'boolean', 'Enable automatic failover')
ON CONFLICT (config_key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_infrastructure_config_key 
ON infrastructure_config(config_key);

-- ============================================================
-- Create view for domain health summary
-- ============================================================

CREATE OR REPLACE VIEW domain_health_summary AS
SELECT 
  d.id,
  d.domain,
  d.status,
  d.bounce_rate,
  d.spam_rate,
  COUNT(DISTINCT i.id) as active_inboxes,
  COALESCE(SUM(CASE WHEN e.type = 'sent' AND e.created_at > NOW() - INTERVAL '1 day' THEN 1 ELSE 0 END), 0) as sent_24h,
  COALESCE(SUM(CASE WHEN e.type = 'bounce' AND e.created_at > NOW() - INTERVAL '1 day' THEN 1 ELSE 0 END), 0) as bounces_24h,
  COALESCE(SUM(CASE WHEN e.type = 'spam' AND e.created_at > NOW() - INTERVAL '1 day' THEN 1 ELSE 0 END), 0) as spam_24h,
  d.created_at,
  CURRENT_TIMESTAMP as refreshed_at
FROM domains d
LEFT JOIN identities i ON i.domain_id = d.id AND i.status = 'active'
LEFT JOIN events e ON e.domain_id = d.id
WHERE d.status != 'inactive'
GROUP BY d.id, d.domain, d.status, d.bounce_rate, d.spam_rate, d.created_at;

-- ============================================================
-- Create view for infrastructure capacity
-- ============================================================

CREATE OR REPLACE VIEW infrastructure_capacity AS
SELECT 
  COUNT(DISTINCT d.id) as healthy_domains,
  COUNT(DISTINCT i.id) as total_inboxes,
  COUNT(DISTINCT d.id) * 4 * 50 as current_capacity,
  COALESCE(SUM(CASE 
    WHEN e.type = 'sent' AND e.created_at > NOW() - INTERVAL '1 day' THEN 1 
    ELSE 0 
  END), 0) as emails_sent_24h,
  COUNT(DISTINCT CASE WHEN i.unavailable_until > NOW() THEN i.id END) as temp_unavailable_inboxes,
  COUNT(DISTINCT CASE WHEN d.status = 'paused' THEN d.id END) as paused_domains,
  CURRENT_TIMESTAMP as calculated_at
FROM domains d
LEFT JOIN identities i ON i.domain_id = d.id
LEFT JOIN events e ON e.domain_id = d.id
WHERE d.status IN ('active', 'warming')
  AND d.bounce_rate < 0.05
  AND d.spam_rate < 0.02;

-- ============================================================
-- Update events table (if not already done)
-- ============================================================

ALTER TABLE events
ADD COLUMN IF NOT EXISTS from_inbox_id UUID REFERENCES identities(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS domain_id UUID REFERENCES domains(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_from_inbox_id 
ON events(from_inbox_id);

CREATE INDEX IF NOT EXISTS idx_events_domain_id 
ON events(domain_id);

CREATE INDEX IF NOT EXISTS idx_events_created_at 
ON events(created_at DESC);

-- ============================================================
-- Add triggers for automatic timestamp updates
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_domains_updated_at ON domains;
CREATE TRIGGER update_domains_updated_at
BEFORE UPDATE ON domains
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_infrastructure_events_updated_at ON infrastructure_events;
CREATE TRIGGER update_infrastructure_events_updated_at
BEFORE UPDATE ON infrastructure_events
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_infrastructure_config_updated_at ON infrastructure_config;
CREATE TRIGGER update_infrastructure_config_updated_at
BEFORE UPDATE ON infrastructure_config
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Grant appropriate permissions (if needed)
-- ============================================================

-- GRANT SELECT ON domain_health_summary TO application_role;
-- GRANT SELECT ON infrastructure_capacity TO application_role;
-- GRANT SELECT, INSERT, UPDATE ON infrastructure_events TO application_role;
-- GRANT SELECT, UPDATE ON domains TO application_role;
-- GRANT SELECT, UPDATE ON identities TO application_role;

-- ============================================================
-- Migration complete
-- ============================================================

COMMENT ON TABLE domains IS 'Sending domains with health metrics';
COMMENT ON TABLE identities IS 'Email inboxes for sending with availability tracking';
COMMENT ON TABLE infrastructure_events IS 'System events: scaling, health, failures, healing';
COMMENT ON TABLE infrastructure_metrics IS 'Performance metrics and trends';
COMMENT ON TABLE infrastructure_config IS 'Configuration for autonomous systems';
COMMENT ON VIEW domain_health_summary IS 'Real-time domain health overview';
COMMENT ON VIEW infrastructure_capacity IS 'Current system capacity calculation';
