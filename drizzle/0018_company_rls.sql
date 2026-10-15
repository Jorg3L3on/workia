-- WRK-I4-19: row-level security per company, a second layer under the app's own filters.
-- A row is visible and writable only when its company_id equals app.company_id, which
-- the app sets per transaction (DATABASE_RLS=1). The table owner (migrations, scripts)
-- is not subject to RLS, so this changes nothing until the app connects as its own role.
-- Rollback: ALTER TABLE ... DISABLE ROW LEVEL SECURITY on each table (docs/multiempresa.md).
ALTER TABLE "people" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "people_company_isolation" ON "people" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "person_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "person_schedules_company_isolation" ON "person_schedules" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "areas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "areas_company_isolation" ON "areas" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "positions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "positions_company_isolation" ON "positions" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "activities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "activities_company_isolation" ON "activities" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "position_activities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "position_activities_company_isolation" ON "position_activities" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "sites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "sites_company_isolation" ON "sites" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "contracts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "contracts_company_isolation" ON "contracts" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "contract_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "contract_templates_company_isolation" ON "contract_templates" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "assets_company_isolation" ON "assets" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "asset_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "asset_movements_company_isolation" ON "asset_movements" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "audit_events_company_isolation" ON "audit_events" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "import_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "import_jobs_company_isolation" ON "import_jobs" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "import_rows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "import_rows_company_isolation" ON "import_rows" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
-- The app role: no BYPASSRLS, only data privileges. Created here when the migration
-- runs with enough privilege; otherwise create it as docs/multiempresa.md explains.
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		BEGIN
			CREATE ROLE workia_app NOLOGIN NOBYPASSRLS;
		EXCEPTION WHEN insufficient_privilege THEN
			RAISE NOTICE 'Could not create role workia_app; create it by hand (docs/multiempresa.md).';
		END;
	END IF;

	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT USAGE ON SCHEMA public TO workia_app;
		GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO workia_app;
		GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO workia_app;
		ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO workia_app;
		ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO workia_app;
	END IF;
END $$;
