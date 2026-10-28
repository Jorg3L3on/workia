-- WRK-I14-3. Ledger of vacation days taken. One row is a range a person
-- already took. The number of days is typed by HR; it is not derived from
-- the calendar span. Voiding sets voided_at. Rows are never deleted.
--
-- pendiente de contador: days are the typed amount, stored in 0.5 steps.
-- pendiente de contador: the service year is the anniversary year, saved on
-- the row. The rest day from the schedule is not stored.
-- There is no column for paying instead of resting.
CREATE TABLE "vacation_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"employment_period_id" uuid,
	"service_year" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"days" numeric(4, 1) NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	CONSTRAINT "vacation_records_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "vacation_records_dates_check" CHECK ("end_date" >= "start_date"),
	CONSTRAINT "vacation_records_days_check" CHECK ("days" > 0 AND "days" <= 999.9 AND "days" = trunc("days" * 2) / 2),
	CONSTRAINT "vacation_records_service_year_check" CHECK ("service_year" >= 0),
	CONSTRAINT "vacation_records_note_check" CHECK ("note" IS NULL OR char_length("note") <= 280)
);
--> statement-breakpoint
ALTER TABLE "vacation_records" ADD CONSTRAINT "vacation_records_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_records" ADD CONSTRAINT "vacation_records_company_person_fk" FOREIGN KEY ("company_id","person_id") REFERENCES "public"."people"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_records" ADD CONSTRAINT "vacation_records_company_period_fk" FOREIGN KEY ("company_id","employment_period_id") REFERENCES "public"."employment_periods"("company_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_records" ADD CONSTRAINT "vacation_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vacation_records_company_person_start_idx" ON "vacation_records" USING btree ("company_id","person_id","start_date");--> statement-breakpoint
ALTER TABLE "vacation_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "vacation_records_company_isolation" ON "vacation_records" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "vacation_records" TO workia_app;
	END IF;
END $$;

-- Rollback (by hand; nothing else references this table):
--   DROP POLICY "vacation_records_company_isolation" ON "vacation_records";
--   DROP TABLE "vacation_records";
--   DELETE FROM drizzle.applied_migrations WHERE tag = '0029_vacation_records';
