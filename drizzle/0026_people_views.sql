-- Iniciativa 3: saved views of the Personas list (a filter and the visible columns),
-- personal or shared with the members of the same company, plus the one index the new
-- filters lack. area_id, position_id, site_id and manager_id already have indexes,
-- and contracts.end_date has contracts_end_date_idx and the partial (company_id, end_date) renewal index (0017).
CREATE TABLE "people_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"filter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "people_views" ADD CONSTRAINT "people_views_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people_views" ADD CONSTRAINT "people_views_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "people_views_company_owner_idx" ON "people_views" USING btree ("company_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "people_views_company_shared_idx" ON "people_views" USING btree ("company_id") WHERE "people_views"."shared";--> statement-breakpoint
ALTER TABLE "people_views" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "people_views_company_isolation" ON "people_views" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "people_views" TO workia_app;
	END IF;
END $$;--> statement-breakpoint
-- «Fecha de ingreso» entre / antes / después, on live expedientes of one company.
CREATE INDEX "people_company_fecha_ingreso_idx" ON "people" USING btree ("company_id","fecha_ingreso") WHERE "people"."deleted_at" is null;

-- Rollback (by hand, in this order; the views are user preferences, nothing else reads them):
--   DROP INDEX IF EXISTS "people_company_fecha_ingreso_idx";
--   DROP TABLE IF EXISTS "people_views";
--   DELETE FROM drizzle.applied_migrations WHERE tag = '0026_people_views';
