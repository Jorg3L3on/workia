-- WRK-I5-4: regions over sites. A company's catalog of regions (name, active, logical
-- delete) and an optional region on each site, with a composite FK so a site can only
-- point at a region of its own company.
CREATE TABLE "regions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "regions_company_id_id_unique" UNIQUE("company_id","id")
);--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "regions_company_name_active_unique" ON "regions" USING btree ("company_id",catalog_key("name")) WHERE "regions"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "regions_deleted_at_idx" ON "regions" USING btree ("deleted_at");--> statement-breakpoint
ALTER TABLE "regions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "regions_company_isolation" ON "regions" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "regions" TO workia_app;
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "region_id" uuid;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_company_region_fk" FOREIGN KEY ("company_id","region_id") REFERENCES "public"."regions"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sites_region_id_idx" ON "sites" USING btree ("company_id","region_id");
