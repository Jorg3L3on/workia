-- Workia 2.0 P-02. Pay periods and the incidencias snapshot frozen at close.
-- The numbers the app shows are aggregates over person_events computed when
-- read (src/lib/timeline/aggregates.ts); nothing here is a counter. The one
-- stored summary is incidencias_period_snapshot, written in the same
-- transaction that closes the period. A reopen deletes it in the transaction
-- that reopens, and the next close writes it again. No triggers.
-- Every company pays quincenal: period is 'YYYY-MM-Q1' or 'YYYY-MM-Q2'.
CREATE TABLE "pay_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"period" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pay_periods_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "pay_periods_company_period_unique" UNIQUE("company_id","period"),
	CONSTRAINT "pay_periods_period_check" CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])-Q[12]$'),
	CONSTRAINT "pay_periods_dates_check" CHECK ("ends_on" >= "starts_on"),
	CONSTRAINT "pay_periods_status_check" CHECK (("status" = 'open' AND "closed_at" IS NULL) OR ("status" = 'closed' AND "closed_at" IS NOT NULL)),
	CONSTRAINT "pay_periods_revision_check" CHECK ("revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "incidencias_period_snapshot" (
	"company_id" uuid NOT NULL,
	"pay_period_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"count" integer NOT NULL,
	"justified" integer NOT NULL,
	"minutes" integer NOT NULL,
	CONSTRAINT "incidencias_period_snapshot_pkey" PRIMARY KEY("pay_period_id","person_id","kind"),
	CONSTRAINT "incidencias_period_snapshot_kind_check" CHECK (char_length("kind") BETWEEN 1 AND 32),
	CONSTRAINT "incidencias_period_snapshot_counts_check" CHECK ("count" > 0 AND "justified" BETWEEN 0 AND "count" AND "minutes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pay_periods" ADD CONSTRAINT "pay_periods_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidencias_period_snapshot" ADD CONSTRAINT "incidencias_period_snapshot_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidencias_period_snapshot" ADD CONSTRAINT "incidencias_period_snapshot_company_period_fk" FOREIGN KEY ("company_id","pay_period_id") REFERENCES "public"."pay_periods"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidencias_period_snapshot" ADD CONSTRAINT "incidencias_period_snapshot_company_person_fk" FOREIGN KEY ("company_id","person_id") REFERENCES "public"."people"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incidencias_period_snapshot" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "pay_periods_company_isolation" ON "pay_periods" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "incidencias_period_snapshot_company_isolation" ON "incidencias_period_snapshot" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
-- The app never deletes a period, and never updates a snapshot row: a frozen
-- snapshot is replaced only by a reopen (delete) and a new close (insert).
-- The default privileges of 0018 grant more, so it is revoked here.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT SELECT, INSERT, UPDATE ON "pay_periods" TO workia_app;
		REVOKE DELETE ON "pay_periods" FROM workia_app;
		GRANT SELECT, INSERT, DELETE ON "incidencias_period_snapshot" TO workia_app;
		REVOKE UPDATE ON "incidencias_period_snapshot" FROM workia_app;
	END IF;
END $$;

-- Rollback (by hand; nothing else references these tables):
--   DROP TABLE "incidencias_period_snapshot";
--   DROP TABLE "pay_periods";
--   DELETE FROM drizzle.applied_migrations WHERE tag = '0035_pay_periods';
