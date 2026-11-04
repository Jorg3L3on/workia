-- Workia 2.0 W2-06: requests and approvals. Employees ask for vacaciones and
-- permisos (con goce, sin goce); their jefe with a live manager grant decides,
-- or HR when there is none. manager_id is the approver stored when the request
-- is created (W2-07 currentApprover); a later change of jefe does not move a
-- pending request. Days only, never amounts. An approved vacation writes a
-- vacation_records row in the same transaction; a cancellation before the
-- first day voids it. Every transition is an audit event and a person_events
-- row. See docs/solicitudes.md.
ALTER TYPE "public"."person_event_type" ADD VALUE IF NOT EXISTS 'permiso';--> statement-breakpoint
CREATE TYPE "public"."time_off_kind" AS ENUM('vacaciones', 'permiso_con_goce', 'permiso_sin_goce');--> statement-breakpoint
CREATE TYPE "public"."time_off_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "time_off_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" time_off_kind NOT NULL,
	"status" time_off_status DEFAULT 'pending' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"days" numeric(4, 1) NOT NULL,
	"note" text,
	"manager_id" uuid,
	"requested_by_account_id" uuid,
	"decided_at" timestamp with time zone,
	"decided_by_account_id" uuid,
	"decided_by_user_id" uuid,
	"decision_reason" text,
	"vacation_record_id" uuid,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_off_requests_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "time_off_requests_dates_check" CHECK ("time_off_requests"."end_date" >= "time_off_requests"."start_date"),
	CONSTRAINT "time_off_requests_days_check" CHECK ("time_off_requests"."days" > 0 AND "time_off_requests"."days" * 2 = trunc("time_off_requests"."days" * 2)),
	CONSTRAINT "time_off_requests_note_check" CHECK ("time_off_requests"."note" IS NULL OR char_length("time_off_requests"."note") <= 280),
	CONSTRAINT "time_off_requests_reason_check" CHECK ("time_off_requests"."decision_reason" IS NULL OR char_length("time_off_requests"."decision_reason") <= 280),
	CONSTRAINT "time_off_requests_decision_check" CHECK (("time_off_requests"."status" = 'pending' AND "time_off_requests"."decided_at" IS NULL) OR ("time_off_requests"."status" = 'cancelled') OR ("time_off_requests"."status" IN ('approved', 'rejected') AND "time_off_requests"."decided_at" IS NOT NULL)),
	CONSTRAINT "time_off_requests_rejection_reason_check" CHECK ("time_off_requests"."status" <> 'rejected' OR "time_off_requests"."decision_reason" IS NOT NULL),
	CONSTRAINT "time_off_requests_vacation_record_check" CHECK ("time_off_requests"."vacation_record_id" IS NULL OR "time_off_requests"."kind" = 'vacaciones'),
	CONSTRAINT "time_off_requests_cancelled_check" CHECK (("time_off_requests"."status" = 'cancelled') = ("time_off_requests"."cancelled_at" IS NOT NULL))
);--> statement-breakpoint
ALTER TABLE "time_off_requests" ADD CONSTRAINT "time_off_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off_requests" ADD CONSTRAINT "time_off_requests_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off_requests" ADD CONSTRAINT "time_off_requests_company_person_fk" FOREIGN KEY ("company_id","person_id") REFERENCES "public"."people"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off_requests" ADD CONSTRAINT "time_off_requests_company_manager_fk" FOREIGN KEY ("company_id","manager_id") REFERENCES "public"."people"("company_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off_requests" ADD CONSTRAINT "time_off_requests_company_requested_by_fk" FOREIGN KEY ("company_id","requested_by_account_id") REFERENCES "public"."employee_accounts"("company_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off_requests" ADD CONSTRAINT "time_off_requests_company_decided_by_fk" FOREIGN KEY ("company_id","decided_by_account_id") REFERENCES "public"."employee_accounts"("company_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off_requests" ADD CONSTRAINT "time_off_requests_company_vacation_record_fk" FOREIGN KEY ("company_id","vacation_record_id") REFERENCES "public"."vacation_records"("company_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- The approvals inbox (docs/keyset.md): approver and status by equality, then
-- the keyset (created_at DESC, id DESC), so a page is one index range scan with
-- no sort. HR's queue is the same index with manager_id IS NULL. HR's list of
-- every request has no index of its own (measured in docs/solicitudes.md).
CREATE INDEX "time_off_requests_inbox_idx" ON "time_off_requests" USING btree ("company_id","manager_id","status","created_at" DESC,"id" DESC);--> statement-breakpoint
CREATE INDEX "time_off_requests_person_idx" ON "time_off_requests" USING btree ("company_id","person_id","created_at" DESC,"id" DESC);--> statement-breakpoint
ALTER TABLE "time_off_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "time_off_requests_company_isolation" ON "time_off_requests" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		-- No DELETE: a request is cancelled, never deleted (a baja or borrado of
		-- the person cascades through the owner).
		GRANT SELECT, INSERT, UPDATE ON "time_off_requests" TO workia_app;
	END IF;
END $$;

-- Rollback (by hand; nothing outside this migration references the table):
--   DROP TABLE "time_off_requests"; DROP TYPE "time_off_status"; DROP TYPE "time_off_kind";
--   ('permiso' stays in person_event_type: Postgres cannot drop an enum value.)
--   DELETE FROM drizzle.applied_migrations WHERE tag = '0047_time_off_requests';
