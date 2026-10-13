-- WRK-I4-4: company_id on every business table, filled with the default company,
-- then NOT NULL, a foreign key to companies, and composite keys so a row can only
-- point to rows of its own company. Runs in one transaction (db:migrate).
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM "companies" WHERE "slug" = 'ferretera-mandiola') THEN
		RAISE EXCEPTION 'default company ferretera-mandiola is missing; apply 0015_companies first';
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "person_schedules" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "areas" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "position_activities" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "contract_templates" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "asset_movements" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "import_rows" ADD COLUMN "company_id" uuid;--> statement-breakpoint
-- data-loss-ok: only fills the company_id column added above; every existing row belongs to the default company.
UPDATE "people" SET "company_id" = (SELECT "id" FROM "companies" WHERE "slug" = 'ferretera-mandiola') WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "person_schedules" SET "company_id" = (SELECT "id" FROM "companies" WHERE "slug" = 'ferretera-mandiola') WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "areas" SET "company_id" = (SELECT "id" FROM "companies" WHERE "slug" = 'ferretera-mandiola') WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "positions" SET "company_id" = (SELECT "id" FROM "companies" WHERE "slug" = 'ferretera-mandiola') WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "activities" SET "company_id" = (SELECT "id" FROM "companies" WHERE "slug" = 'ferretera-mandiola') WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "position_activities" SET "company_id" = (SELECT "id" FROM "companies" WHERE "slug" = 'ferretera-mandiola') WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "sites" SET "company_id" = (SELECT "id" FROM "companies" WHERE "slug" = 'ferretera-mandiola') WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "contracts" SET "company_id" = (SELECT "id" FROM "companies" WHERE "slug" = 'ferretera-mandiola') WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "contract_templates" SET "company_id" = (SELECT "id" FROM "companies" WHERE "slug" = 'ferretera-mandiola') WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "assets" SET "company_id" = (SELECT "id" FROM "companies" WHERE "slug" = 'ferretera-mandiola') WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "asset_movements" SET "company_id" = (SELECT "id" FROM "companies" WHERE "slug" = 'ferretera-mandiola') WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "audit_events" SET "company_id" = (SELECT "id" FROM "companies" WHERE "slug" = 'ferretera-mandiola') WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "import_jobs" SET "company_id" = (SELECT "id" FROM "companies" WHERE "slug" = 'ferretera-mandiola') WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "import_rows" SET "company_id" = (SELECT "id" FROM "companies" WHERE "slug" = 'ferretera-mandiola') WHERE "company_id" IS NULL;--> statement-breakpoint
ALTER TABLE "people" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "person_schedules" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "areas" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "positions" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "position_activities" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_templates" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_movements" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "import_rows" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_schedules" ADD CONSTRAINT "person_schedules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_activities" ADD CONSTRAINT "position_activities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_company_id_id_unique" UNIQUE("company_id","id");--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_company_id_id_unique" UNIQUE("company_id","id");--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_company_id_id_unique" UNIQUE("company_id","id");--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_company_id_id_unique" UNIQUE("company_id","id");--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_company_id_id_unique" UNIQUE("company_id","id");--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_company_id_id_unique" UNIQUE("company_id","id");--> statement-breakpoint
ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_company_id_id_unique" UNIQUE("company_id","id");--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_company_id_id_unique" UNIQUE("company_id","id");--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_company_id_id_unique" UNIQUE("company_id","id");--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_company_area_fk" FOREIGN KEY ("company_id","area_id") REFERENCES "public"."areas"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_company_position_fk" FOREIGN KEY ("company_id","position_id") REFERENCES "public"."positions"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_company_manager_fk" FOREIGN KEY ("company_id","manager_id") REFERENCES "public"."people"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_company_site_fk" FOREIGN KEY ("company_id","site_id") REFERENCES "public"."sites"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_schedules" ADD CONSTRAINT "person_schedules_company_person_fk" FOREIGN KEY ("company_id","person_id") REFERENCES "public"."people"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_company_parent_area_fk" FOREIGN KEY ("company_id","parent_area_id") REFERENCES "public"."areas"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_company_area_fk" FOREIGN KEY ("company_id","area_id") REFERENCES "public"."areas"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_activities" ADD CONSTRAINT "position_activities_company_position_fk" FOREIGN KEY ("company_id","position_id") REFERENCES "public"."positions"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_activities" ADD CONSTRAINT "position_activities_company_activity_fk" FOREIGN KEY ("company_id","activity_id") REFERENCES "public"."activities"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_company_person_fk" FOREIGN KEY ("company_id","person_id") REFERENCES "public"."people"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_company_template_fk" FOREIGN KEY ("company_id","template_id") REFERENCES "public"."contract_templates"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_company_previous_contract_fk" FOREIGN KEY ("company_id","previous_contract_id") REFERENCES "public"."contracts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_company_holder_fk" FOREIGN KEY ("company_id","holder_id") REFERENCES "public"."people"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_company_asset_fk" FOREIGN KEY ("company_id","asset_id") REFERENCES "public"."assets"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_company_person_fk" FOREIGN KEY ("company_id","person_id") REFERENCES "public"."people"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_company_job_fk" FOREIGN KEY ("company_id","job_id") REFERENCES "public"."import_jobs"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_company_target_person_fk" FOREIGN KEY ("company_id","target_person_id") REFERENCES "public"."people"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_company_target_contract_fk" FOREIGN KEY ("company_id","target_contract_id") REFERENCES "public"."contracts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "person_schedules_company_id_idx" ON "person_schedules" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "position_activities_company_id_idx" ON "position_activities" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "asset_movements_company_id_idx" ON "asset_movements" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "audit_events_company_id_idx" ON "audit_events" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "import_rows_company_id_idx" ON "import_rows" USING btree ("company_id");
