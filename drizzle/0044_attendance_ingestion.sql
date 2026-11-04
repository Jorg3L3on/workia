-- W2-12 (Workia 2.0). Attendance ingestion. Punches land in person_events,
-- one attendance row per person per day (0031); these tables hold what
-- ingestion needs around them (docs/asistencia.md):
--
-- attendance_devices: each checador, with the layout of its CSV export (the
--   checador models are not decided, so the format is data) and the SHA-256
--   of its push token for /api/asistencia/checadas.
-- attendance_badges: a person's number on the checadores, unique per company.
-- attendance_checkin_sites: app check-in at a site: position, radius and the
--   secret its QR codes are signed with.
-- attendance_batches: what each CSV upload did, and one row per device per
--   day for pushes, so pushing every minute stays one row a day.
-- attendance_unmatched: punches ingestion could not place, with the raw row,
--   until HR assigns the number to a person or dismisses the row. The same
--   punch or line reported twice stays one row.
--
-- All company-scoped with the same RLS policy as the other business tables.
CREATE TABLE "attendance_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"site_id" uuid,
	"name" text NOT NULL,
	"csv_format" jsonb NOT NULL,
	"token_hash" text,
	"token_hint" text,
	"active" boolean DEFAULT true NOT NULL,
	"last_push_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_devices_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "attendance_devices_name_check" CHECK (char_length("attendance_devices"."name") BETWEEN 1 AND 80),
	CONSTRAINT "attendance_devices_csv_format_check" CHECK (jsonb_typeof("attendance_devices"."csv_format") = 'object' AND pg_column_size("attendance_devices"."csv_format") <= 2048)
);--> statement-breakpoint
ALTER TABLE "attendance_devices" ADD CONSTRAINT "attendance_devices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_devices" ADD CONSTRAINT "attendance_devices_company_site_fk" FOREIGN KEY ("company_id","site_id") REFERENCES "public"."sites"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_devices_company_name_unique" ON "attendance_devices" USING btree ("company_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_devices_token_hash_unique" ON "attendance_devices" USING btree ("token_hash") WHERE "attendance_devices"."token_hash" is not null;--> statement-breakpoint
ALTER TABLE "attendance_devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "attendance_devices_company_isolation" ON "attendance_devices" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "attendance_devices" TO workia_app;
	END IF;
END $$;--> statement-breakpoint
CREATE TABLE "attendance_badges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"badge" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_badges_company_badge_unique" UNIQUE("company_id","badge"),
	CONSTRAINT "attendance_badges_badge_check" CHECK (char_length("attendance_badges"."badge") BETWEEN 1 AND 40)
);--> statement-breakpoint
ALTER TABLE "attendance_badges" ADD CONSTRAINT "attendance_badges_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_badges" ADD CONSTRAINT "attendance_badges_company_person_fk" FOREIGN KEY ("company_id","person_id") REFERENCES "public"."people"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_badges_company_person_idx" ON "attendance_badges" USING btree ("company_id","person_id");--> statement-breakpoint
ALTER TABLE "attendance_badges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "attendance_badges_company_isolation" ON "attendance_badges" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "attendance_badges" TO workia_app;
	END IF;
END $$;--> statement-breakpoint
CREATE TABLE "attendance_checkin_sites" (
	"company_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"radius_meters" integer DEFAULT 150 NOT NULL,
	"qr_mode" text DEFAULT 'rotating' NOT NULL,
	"qr_secret" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_checkin_sites_pkey" PRIMARY KEY("company_id","site_id"),
	CONSTRAINT "attendance_checkin_sites_position_check" CHECK ("attendance_checkin_sites"."latitude" BETWEEN -90 AND 90 AND "attendance_checkin_sites"."longitude" BETWEEN -180 AND 180),
	CONSTRAINT "attendance_checkin_sites_radius_check" CHECK ("attendance_checkin_sites"."radius_meters" BETWEEN 25 AND 2000),
	CONSTRAINT "attendance_checkin_sites_qr_mode_check" CHECK ("attendance_checkin_sites"."qr_mode" IN ('rotating', 'printed'))
);--> statement-breakpoint
ALTER TABLE "attendance_checkin_sites" ADD CONSTRAINT "attendance_checkin_sites_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_checkin_sites" ADD CONSTRAINT "attendance_checkin_sites_company_site_fk" FOREIGN KEY ("company_id","site_id") REFERENCES "public"."sites"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_checkin_sites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "attendance_checkin_sites_company_isolation" ON "attendance_checkin_sites" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "attendance_checkin_sites" TO workia_app;
	END IF;
END $$;--> statement-breakpoint
CREATE TABLE "attendance_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"source" text NOT NULL,
	"push_day" date,
	"file_name" text,
	"rows" integer DEFAULT 0 NOT NULL,
	"punches_added" integer DEFAULT 0 NOT NULL,
	"duplicates" integer DEFAULT 0 NOT NULL,
	"unmatched" integer DEFAULT 0 NOT NULL,
	"invalid" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_batches_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "attendance_batches_source_check" CHECK ("attendance_batches"."source" IN ('csv', 'device')),
	CONSTRAINT "attendance_batches_push_day_check" CHECK (("attendance_batches"."source" = 'device') = ("attendance_batches"."push_day" IS NOT NULL)),
	CONSTRAINT "attendance_batches_counts_check" CHECK ("attendance_batches"."rows" >= 0 AND "attendance_batches"."punches_added" >= 0 AND "attendance_batches"."duplicates" >= 0 AND "attendance_batches"."unmatched" >= 0 AND "attendance_batches"."invalid" >= 0)
);--> statement-breakpoint
ALTER TABLE "attendance_batches" ADD CONSTRAINT "attendance_batches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_batches" ADD CONSTRAINT "attendance_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_batches" ADD CONSTRAINT "attendance_batches_company_device_fk" FOREIGN KEY ("company_id","device_id") REFERENCES "public"."attendance_devices"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_batches_company_created_idx" ON "attendance_batches" USING btree ("company_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_batches_device_push_day_unique" ON "attendance_batches" USING btree ("device_id","push_day") WHERE "attendance_batches"."source" = 'device';--> statement-breakpoint
ALTER TABLE "attendance_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "attendance_batches_company_isolation" ON "attendance_batches" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "attendance_batches" TO workia_app;
	END IF;
END $$;--> statement-breakpoint
CREATE TABLE "attendance_unmatched" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"line" integer NOT NULL,
	"badge" text,
	"punched_at" timestamp with time zone,
	"kind" text,
	"raw" jsonb NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_unmatched_reason_check" CHECK ("attendance_unmatched"."reason" IN ('unknown_badge', 'invalid_row')),
	CONSTRAINT "attendance_unmatched_kind_check" CHECK ("attendance_unmatched"."kind" IS NULL OR "attendance_unmatched"."kind" IN ('in', 'out')),
	CONSTRAINT "attendance_unmatched_raw_check" CHECK (jsonb_typeof("attendance_unmatched"."raw") = 'array' AND pg_column_size("attendance_unmatched"."raw") <= 2048),
	CONSTRAINT "attendance_unmatched_badge_check" CHECK ("attendance_unmatched"."badge" IS NULL OR char_length("attendance_unmatched"."badge") BETWEEN 1 AND 40)
);--> statement-breakpoint
ALTER TABLE "attendance_unmatched" ADD CONSTRAINT "attendance_unmatched_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_unmatched" ADD CONSTRAINT "attendance_unmatched_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_unmatched" ADD CONSTRAINT "attendance_unmatched_company_batch_fk" FOREIGN KEY ("company_id","batch_id") REFERENCES "public"."attendance_batches"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_unmatched" ADD CONSTRAINT "attendance_unmatched_company_device_fk" FOREIGN KEY ("company_id","device_id") REFERENCES "public"."attendance_devices"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_unmatched_open_idx" ON "attendance_unmatched" USING btree ("company_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "attendance_unmatched"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "attendance_unmatched_open_badge_idx" ON "attendance_unmatched" USING btree ("company_id","badge") WHERE "attendance_unmatched"."resolved_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_unmatched_punch_unique" ON "attendance_unmatched" USING btree ("company_id","badge","punched_at") WHERE "attendance_unmatched"."badge" is not null and "attendance_unmatched"."punched_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_unmatched_invalid_unique" ON "attendance_unmatched" USING btree ("company_id","device_id",md5("raw"::text)) WHERE "attendance_unmatched"."reason" = 'invalid_row';--> statement-breakpoint
ALTER TABLE "attendance_unmatched" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "attendance_unmatched_company_isolation" ON "attendance_unmatched" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "attendance_unmatched" TO workia_app;
	END IF;
END $$;

-- Rollback (by hand, in this order; nothing else references these tables):
--   DROP TABLE "attendance_unmatched";
--   DROP TABLE "attendance_batches";
--   DROP TABLE "attendance_checkin_sites";
--   DROP TABLE "attendance_badges";
--   DROP TABLE "attendance_devices";
--   DELETE FROM drizzle.applied_migrations WHERE tag = '0044_attendance_ingestion';
