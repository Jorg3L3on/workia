-- Rollback of the multi-company migrations 0015-0018 (WRK-I4-17).
-- Returns the schema to its 0014 state and removes the registry rows, in one
-- transaction. Only valid while every row still belongs to the default company:
-- it refuses otherwise, because dropping company_id would merge companies.
-- Prefer restoring the Neon restore point taken before the cutover; use this
-- when that is not possible. Run as the database owner:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/cutover/rollback.sql
BEGIN;

DO $$
BEGIN
	IF (SELECT count(*) FROM companies) > 1 THEN
		RAISE EXCEPTION 'More than one company exists; rolling back would merge their data. Restore the Neon restore point instead.';
	END IF;
END $$;

-- 0018: row-level security.
DROP POLICY IF EXISTS "people_company_isolation" ON "people";
ALTER TABLE "people" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "person_schedules_company_isolation" ON "person_schedules";
ALTER TABLE "person_schedules" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "areas_company_isolation" ON "areas";
ALTER TABLE "areas" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "positions_company_isolation" ON "positions";
ALTER TABLE "positions" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "activities_company_isolation" ON "activities";
ALTER TABLE "activities" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "position_activities_company_isolation" ON "position_activities";
ALTER TABLE "position_activities" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sites_company_isolation" ON "sites";
ALTER TABLE "sites" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "contracts_company_isolation" ON "contracts";
ALTER TABLE "contracts" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "contract_templates_company_isolation" ON "contract_templates";
ALTER TABLE "contract_templates" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "assets_company_isolation" ON "assets";
ALTER TABLE "assets" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "asset_movements_company_isolation" ON "asset_movements";
ALTER TABLE "asset_movements" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_events_company_isolation" ON "audit_events";
ALTER TABLE "audit_events" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "import_jobs_company_isolation" ON "import_jobs";
ALTER TABLE "import_jobs" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "import_rows_company_isolation" ON "import_rows";
ALTER TABLE "import_rows" DISABLE ROW LEVEL SECURITY;

-- 0017: per-company indexes back to the installation-wide ones.
DROP INDEX IF EXISTS "people_company_curp_active_unique";
DROP INDEX IF EXISTS "people_company_rfc_active_unique";
DROP INDEX IF EXISTS "people_company_nss_active_unique";
DROP INDEX IF EXISTS "areas_company_name_active_unique";
DROP INDEX IF EXISTS "positions_company_name_active_unique";
DROP INDEX IF EXISTS "sites_company_name_active_unique";
DROP INDEX IF EXISTS "activities_company_name_active_unique";
DROP INDEX IF EXISTS "assets_company_identifier_active_unique";
DROP INDEX IF EXISTS "import_jobs_single_applying_idx";
DROP INDEX IF EXISTS "people_company_live_updated_idx";
DROP INDEX IF EXISTS "people_company_status_family_idx";
DROP INDEX IF EXISTS "contracts_company_vigente_person_idx";
DROP INDEX IF EXISTS "contracts_company_renewal_end_date_idx";
DROP INDEX IF EXISTS "assets_company_status_name_idx";
DROP INDEX IF EXISTS "assets_company_holder_idx";
DROP INDEX IF EXISTS "audit_events_company_occurred_idx";
DROP INDEX IF EXISTS "audit_events_company_resource_occurred_idx";
DROP INDEX IF EXISTS "import_jobs_company_created_idx";
DROP FUNCTION IF EXISTS "public"."catalog_key"(text);
CREATE UNIQUE INDEX "people_curp_active_unique" ON "people" USING btree ("curp") WHERE "people"."deleted_at" is null and "people"."curp" is not null;
CREATE UNIQUE INDEX "people_rfc_active_unique" ON "people" USING btree ("rfc") WHERE "people"."deleted_at" is null and "people"."rfc" is not null;
CREATE UNIQUE INDEX "import_jobs_single_applying_idx" ON "import_jobs" USING btree ("type") WHERE "import_jobs"."status" = 'applying';
CREATE INDEX "contracts_vigente_person_idx" ON "contracts" USING btree ("person_id") WHERE "status" = 'vigente' AND "deleted_at" IS NULL;
CREATE INDEX "contracts_renewal_end_date_idx" ON "contracts" USING btree ("end_date") WHERE "contracts"."status" = 'vigente' AND "contracts"."type" = 'determinado' AND "contracts"."deleted_at" IS NULL;
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events" USING btree ("occurred_at");
CREATE INDEX "audit_events_resource_idx" ON "audit_events" USING btree ("resource_type","resource_id");
CREATE INDEX "audit_events_resource_occurred_idx" ON "audit_events" USING btree ("resource_type","resource_id","occurred_at" DESC NULLS LAST);

-- 0016: company_id and the composite keys that use it (dropped with the column).
ALTER TABLE "people" DROP COLUMN IF EXISTS "company_id" CASCADE;
ALTER TABLE "person_schedules" DROP COLUMN IF EXISTS "company_id" CASCADE;
ALTER TABLE "areas" DROP COLUMN IF EXISTS "company_id" CASCADE;
ALTER TABLE "positions" DROP COLUMN IF EXISTS "company_id" CASCADE;
ALTER TABLE "activities" DROP COLUMN IF EXISTS "company_id" CASCADE;
ALTER TABLE "position_activities" DROP COLUMN IF EXISTS "company_id" CASCADE;
ALTER TABLE "sites" DROP COLUMN IF EXISTS "company_id" CASCADE;
ALTER TABLE "contracts" DROP COLUMN IF EXISTS "company_id" CASCADE;
ALTER TABLE "contract_templates" DROP COLUMN IF EXISTS "company_id" CASCADE;
ALTER TABLE "assets" DROP COLUMN IF EXISTS "company_id" CASCADE;
ALTER TABLE "asset_movements" DROP COLUMN IF EXISTS "company_id" CASCADE;
ALTER TABLE "audit_events" DROP COLUMN IF EXISTS "company_id" CASCADE;
ALTER TABLE "import_jobs" DROP COLUMN IF EXISTS "company_id" CASCADE;
ALTER TABLE "import_rows" DROP COLUMN IF EXISTS "company_id" CASCADE;

-- 0015: companies, memberships, platform flag. user_roles was never touched.
DROP TABLE IF EXISTS "company_memberships";
DROP TABLE IF EXISTS "companies";
DROP TYPE IF EXISTS "public"."membership_status";
DROP TYPE IF EXISTS "public"."company_status";
ALTER TABLE "users" DROP COLUMN IF EXISTS "is_platform_admin";

-- The registry forgets them, so db:migrate would apply them again.
DELETE FROM "drizzle"."applied_migrations"
WHERE "tag" IN ('0015_companies', '0016_company_id', '0017_company_unique_indexes', '0018_company_rls');

COMMIT;
