-- WRK-I4-5: uniqueness and list indexes per company.
-- Before applying: npm run db:report-duplicates must print "Sin duplicados activos".
-- SQL twin of catalogKey() (src/lib/import/format.ts): lower case, no accents, single spaces.
CREATE OR REPLACE FUNCTION "public"."catalog_key"("value" text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
	SELECT btrim(regexp_replace(translate(lower("value"), 'áàäâãåéèëêíìïîóòöôõúùüûñçý', 'aaaaaaeeeeiiiiooooouuuuncy'), '\s+', ' ', 'g'))
$$;--> statement-breakpoint
DO $$
DECLARE
	found text;
BEGIN
	SELECT string_agg(label, ', ') INTO found FROM (
		SELECT 'CURP' AS label WHERE EXISTS (SELECT 1 FROM "people" WHERE "deleted_at" IS NULL AND "curp" IS NOT NULL GROUP BY "company_id", "curp" HAVING count(*) > 1)
		UNION ALL SELECT 'RFC' WHERE EXISTS (SELECT 1 FROM "people" WHERE "deleted_at" IS NULL AND "rfc" IS NOT NULL GROUP BY "company_id", "rfc" HAVING count(*) > 1)
		UNION ALL SELECT 'NSS' WHERE EXISTS (SELECT 1 FROM "people" WHERE "deleted_at" IS NULL AND "nss" IS NOT NULL GROUP BY "company_id", "nss" HAVING count(*) > 1)
		UNION ALL SELECT 'áreas' WHERE EXISTS (SELECT 1 FROM "areas" WHERE "deleted_at" IS NULL GROUP BY "company_id", catalog_key("name") HAVING count(*) > 1)
		UNION ALL SELECT 'puestos' WHERE EXISTS (SELECT 1 FROM "positions" WHERE "deleted_at" IS NULL GROUP BY "company_id", catalog_key("name") HAVING count(*) > 1)
		UNION ALL SELECT 'sucursales' WHERE EXISTS (SELECT 1 FROM "sites" WHERE "deleted_at" IS NULL GROUP BY "company_id", catalog_key("name") HAVING count(*) > 1)
		UNION ALL SELECT 'actividades' WHERE EXISTS (SELECT 1 FROM "activities" WHERE "deleted_at" IS NULL GROUP BY "company_id", catalog_key("name") HAVING count(*) > 1)
		UNION ALL SELECT 'activos' WHERE EXISTS (SELECT 1 FROM "assets" WHERE "deleted_at" IS NULL GROUP BY "company_id", "identifier" HAVING count(*) > 1)
	) duplicated;

	IF found IS NOT NULL THEN
		RAISE EXCEPTION 'active duplicates per company in: %; resolve them before migrating (npm run db:report-duplicates)', found;
	END IF;
END $$;--> statement-breakpoint
-- Identity: unique per company, not across the installation.
DROP INDEX IF EXISTS "people_curp_active_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "people_rfc_active_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "people_company_curp_active_unique" ON "people" USING btree ("company_id","curp") WHERE "people"."deleted_at" is null and "people"."curp" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "people_company_rfc_active_unique" ON "people" USING btree ("company_id","rfc") WHERE "people"."deleted_at" is null and "people"."rfc" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "people_company_nss_active_unique" ON "people" USING btree ("company_id","nss") WHERE "people"."deleted_at" is null and "people"."nss" is not null;--> statement-breakpoint
-- Catalog names and asset identifiers: unique per company among live rows.
CREATE UNIQUE INDEX "areas_company_name_active_unique" ON "areas" USING btree ("company_id",catalog_key("name")) WHERE "areas"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "positions_company_name_active_unique" ON "positions" USING btree ("company_id",catalog_key("name")) WHERE "positions"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "sites_company_name_active_unique" ON "sites" USING btree ("company_id",catalog_key("name")) WHERE "sites"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "activities_company_name_active_unique" ON "activities" USING btree ("company_id",catalog_key("name")) WHERE "activities"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "assets_company_identifier_active_unique" ON "assets" USING btree ("company_id","identifier") WHERE "assets"."deleted_at" is null;--> statement-breakpoint
-- One import applying per company (was: per installation).
DROP INDEX IF EXISTS "import_jobs_single_applying_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "import_jobs_single_applying_idx" ON "import_jobs" USING btree ("company_id","type") WHERE "import_jobs"."status" = 'applying';--> statement-breakpoint
-- List queries filter by company first.
CREATE INDEX "people_company_live_updated_idx" ON "people" USING btree ("company_id","updated_at") WHERE "people"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "people_company_status_family_idx" ON "people" USING btree ("company_id","status","apellido_paterno") WHERE "people"."deleted_at" is null;--> statement-breakpoint
DROP INDEX IF EXISTS "contracts_vigente_person_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "contracts_renewal_end_date_idx";--> statement-breakpoint
CREATE INDEX "contracts_company_vigente_person_idx" ON "contracts" USING btree ("company_id","person_id") WHERE "contracts"."status" = 'vigente' AND "contracts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "contracts_company_renewal_end_date_idx" ON "contracts" USING btree ("company_id","end_date") WHERE "contracts"."status" = 'vigente' AND "contracts"."type" = 'determinado' AND "contracts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "assets_company_status_name_idx" ON "assets" USING btree ("company_id","status","name") WHERE "assets"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "assets_company_holder_idx" ON "assets" USING btree ("company_id","holder_id");--> statement-breakpoint
DROP INDEX IF EXISTS "audit_events_occurred_at_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "audit_events_resource_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "audit_events_resource_occurred_idx";--> statement-breakpoint
CREATE INDEX "audit_events_company_occurred_idx" ON "audit_events" USING btree ("company_id","occurred_at" DESC);--> statement-breakpoint
CREATE INDEX "audit_events_company_resource_occurred_idx" ON "audit_events" USING btree ("company_id","resource_type","resource_id","occurred_at" DESC);--> statement-breakpoint
CREATE INDEX "import_jobs_company_created_idx" ON "import_jobs" USING btree ("company_id","created_at" DESC);
