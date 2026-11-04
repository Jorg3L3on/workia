-- W2-09 (Workia 2.0). Privacy, retention and ARCO under the LFPDPPP in force
-- (the 2025 law). Each company is the «responsable» of its people's data, so
-- the four tables are company-scoped with the same RLS policy as the others.
--
-- privacy_notices: published versions of the notice; never edited, a change
--   is a new version.
-- privacy_notice_acceptances: who accepted which version, when and how
--   (employee app at first login, or on paper recorded by HR).
-- personal_data_access_log: every read of a document or receipt about a
--   person. Append-only; the retention job (src/lib/privacy/retention.ts)
--   deletes rows past their period, in batches.
-- arco_requests: access, rectification, cancellation and opposition
--   requests, with the legal answer date.
--
-- Files never go in the database: the log stores the kind and the id of what
-- was read, not the file.
CREATE TABLE "privacy_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_notices_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "privacy_notices_company_version_unique" UNIQUE("company_id","version"),
	CONSTRAINT "privacy_notices_version_check" CHECK ("privacy_notices"."version" > 0),
	CONSTRAINT "privacy_notices_body_check" CHECK (char_length("privacy_notices"."body") BETWEEN 1 AND 50000)
);--> statement-breakpoint
ALTER TABLE "privacy_notices" ADD CONSTRAINT "privacy_notices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_notices" ADD CONSTRAINT "privacy_notices_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_notices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "privacy_notices_company_isolation" ON "privacy_notices" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "privacy_notices" TO workia_app;
	END IF;
END $$;--> statement-breakpoint
CREATE TABLE "privacy_notice_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"notice_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"recorded_by" uuid,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_notice_acceptances_company_notice_person_unique" UNIQUE("company_id","notice_id","person_id"),
	CONSTRAINT "privacy_notice_acceptances_channel_check" CHECK ("privacy_notice_acceptances"."channel" IN ('employee_app', 'hr'))
);--> statement-breakpoint
ALTER TABLE "privacy_notice_acceptances" ADD CONSTRAINT "privacy_notice_acceptances_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_notice_acceptances" ADD CONSTRAINT "privacy_notice_acceptances_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_notice_acceptances" ADD CONSTRAINT "privacy_notice_acceptances_company_notice_fk" FOREIGN KEY ("company_id","notice_id") REFERENCES "public"."privacy_notices"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_notice_acceptances" ADD CONSTRAINT "privacy_notice_acceptances_company_person_fk" FOREIGN KEY ("company_id","person_id") REFERENCES "public"."people"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "privacy_notice_acceptances_company_person_idx" ON "privacy_notice_acceptances" USING btree ("company_id","person_id");--> statement-breakpoint
ALTER TABLE "privacy_notice_acceptances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "privacy_notice_acceptances_company_isolation" ON "privacy_notice_acceptances" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "privacy_notice_acceptances" TO workia_app;
	END IF;
END $$;--> statement-breakpoint
CREATE TABLE "personal_data_access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"resource" text NOT NULL,
	"resource_id" uuid,
	"actor_kind" text NOT NULL,
	"actor_user_id" uuid,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_data_access_log_resource_check" CHECK ("personal_data_access_log"."resource" IN ('contract_pdf', 'document_file', 'payroll_receipt', 'vacation_constancia', 'arco_export')),
	CONSTRAINT "personal_data_access_log_actor_check" CHECK ("personal_data_access_log"."actor_kind" IN ('hr_user', 'employee', 'mcp'))
);--> statement-breakpoint
ALTER TABLE "personal_data_access_log" ADD CONSTRAINT "personal_data_access_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_data_access_log" ADD CONSTRAINT "personal_data_access_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_data_access_log" ADD CONSTRAINT "personal_data_access_log_company_person_fk" FOREIGN KEY ("company_id","person_id") REFERENCES "public"."people"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "personal_data_access_log_company_person_idx" ON "personal_data_access_log" USING btree ("company_id","person_id","accessed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "personal_data_access_log_company_accessed_idx" ON "personal_data_access_log" USING btree ("company_id","accessed_at");--> statement-breakpoint
ALTER TABLE "personal_data_access_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "personal_data_access_log_company_isolation" ON "personal_data_access_log" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "personal_data_access_log" TO workia_app;
	END IF;
END $$;--> statement-breakpoint
CREATE TABLE "arco_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"channel" text NOT NULL,
	"detail" text NOT NULL,
	"response" text,
	"received_on" date NOT NULL,
	"due_on" date NOT NULL,
	"created_by" uuid,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "arco_requests_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "arco_requests_kind_check" CHECK ("arco_requests"."kind" IN ('access', 'rectification', 'cancellation', 'opposition')),
	CONSTRAINT "arco_requests_status_check" CHECK ("arco_requests"."status" IN ('received', 'resolved', 'rejected')),
	CONSTRAINT "arco_requests_channel_check" CHECK ("arco_requests"."channel" IN ('employee_app', 'hr')),
	CONSTRAINT "arco_requests_detail_check" CHECK (char_length("arco_requests"."detail") BETWEEN 1 AND 2000),
	CONSTRAINT "arco_requests_response_check" CHECK ("arco_requests"."response" IS NULL OR char_length("arco_requests"."response") <= 4000),
	CONSTRAINT "arco_requests_dates_check" CHECK ("arco_requests"."due_on" >= "arco_requests"."received_on"),
	CONSTRAINT "arco_requests_resolution_check" CHECK (("arco_requests"."status" = 'received') = ("arco_requests"."resolved_at" IS NULL))
);--> statement-breakpoint
ALTER TABLE "arco_requests" ADD CONSTRAINT "arco_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arco_requests" ADD CONSTRAINT "arco_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arco_requests" ADD CONSTRAINT "arco_requests_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arco_requests" ADD CONSTRAINT "arco_requests_company_person_fk" FOREIGN KEY ("company_id","person_id") REFERENCES "public"."people"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "arco_requests_company_status_due_idx" ON "arco_requests" USING btree ("company_id","status","due_on");--> statement-breakpoint
CREATE INDEX "arco_requests_company_person_idx" ON "arco_requests" USING btree ("company_id","person_id");--> statement-breakpoint
ALTER TABLE "arco_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "arco_requests_company_isolation" ON "arco_requests" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "arco_requests" TO workia_app;
	END IF;
END $$;

-- Rollback (by hand, in this order; nothing else references these tables):
--   DROP TABLE "privacy_notice_acceptances";
--   DROP TABLE "privacy_notices";
--   DROP TABLE "personal_data_access_log";
--   DROP TABLE "arco_requests";
--   DELETE FROM drizzle.applied_migrations WHERE tag = '0033_privacy_arco';
