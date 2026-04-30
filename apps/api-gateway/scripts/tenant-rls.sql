-- Xavira Orbit tenant isolation pool model.
-- Run with: pnpm -C apps/api-gateway tenant:rls
--
-- Application sessions should set the client context before tenant-scoped work:
--   SELECT xavira_set_client_id(123);
--
-- For strongest isolation, use a non-owner database role for the app. Table owners
-- can bypass RLS unless FORCE ROW LEVEL SECURITY is enabled after rollout.

CREATE SCHEMA IF NOT EXISTS xavira_security;

CREATE OR REPLACE FUNCTION xavira_current_client_id() RETURNS BIGINT AS $$
DECLARE
  raw TEXT;
BEGIN
  raw := current_setting('app.current_client_id', true);
  IF raw IS NULL OR raw = '' THEN
    RETURN NULL;
  END IF;
  RETURN raw::BIGINT;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION xavira_set_client_id(client_id BIGINT) RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.current_client_id', client_id::TEXT, false);
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  tenant_table TEXT;
  tenant_tables TEXT[] := ARRAY[
    'contacts',
    'sequences',
    'campaigns',
    'domains',
    'identities',
    'suppression_list',
    'queue_jobs',
    'events',
    'operator_actions',
    'domain_pause_events',
    'adaptive_state_snapshots',
    'provider_health_snapshots',
    'seed_placement_events',
    'reputation_state',
    'reputation_events',
    'public_api_keys',
    'reputation_api_logs',
    'copilot_memory',
    'copilot_proposals',
    'copilot_settings',
    'system_metrics',
    'alerts',
    'email_threads',
    'decision_audit_logs',
    'audit_logs',
    'encrypted_secrets'
  ];
BEGIN
  FOREACH tenant_table IN ARRAY tenant_tables LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND information_schema.columns.table_name = tenant_table
        AND column_name = 'client_id'
    ) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
      EXECUTE format('DROP POLICY IF EXISTS xavira_tenant_select ON %I', tenant_table);
      EXECUTE format('DROP POLICY IF EXISTS xavira_tenant_insert ON %I', tenant_table);
      EXECUTE format('DROP POLICY IF EXISTS xavira_tenant_update ON %I', tenant_table);
      EXECUTE format('DROP POLICY IF EXISTS xavira_tenant_delete ON %I', tenant_table);

      EXECUTE format(
        'CREATE POLICY xavira_tenant_select ON %I FOR SELECT USING (xavira_current_client_id() IS NULL OR client_id IS NULL OR client_id = xavira_current_client_id())',
        tenant_table
      );
      EXECUTE format(
        'CREATE POLICY xavira_tenant_insert ON %I FOR INSERT WITH CHECK (xavira_current_client_id() IS NULL OR client_id IS NULL OR client_id = xavira_current_client_id())',
        tenant_table
      );
      EXECUTE format(
        'CREATE POLICY xavira_tenant_update ON %I FOR UPDATE USING (xavira_current_client_id() IS NULL OR client_id IS NULL OR client_id = xavira_current_client_id()) WITH CHECK (xavira_current_client_id() IS NULL OR client_id IS NULL OR client_id = xavira_current_client_id())',
        tenant_table
      );
      EXECUTE format(
        'CREATE POLICY xavira_tenant_delete ON %I FOR DELETE USING (xavira_current_client_id() IS NULL OR client_id IS NULL OR client_id = xavira_current_client_id())',
        tenant_table
      );
    END IF;
  END LOOP;
END $$;

-- Uncomment after all application database sessions set app.current_client_id
-- and the app uses a non-owner DB role:
-- ALTER TABLE contacts FORCE ROW LEVEL SECURITY;
-- ALTER TABLE campaigns FORCE ROW LEVEL SECURITY;
-- ALTER TABLE domains FORCE ROW LEVEL SECURITY;
