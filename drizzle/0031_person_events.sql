-- Workia 2.0 P-01. The person timeline: one append-only table, person_events,
-- that every event about a person goes into, keyed by (company_id, person_id)
-- like every business table (docs/identity-model.md, docs/timeline.md).
-- No CURP column, no account id, no partitions, no extension. Attendance is one
-- row per person per day: its dedupe key is 'attendance:<date>' and the unique
-- (person_id, dedupe_key) index refuses a second row for the same day. Keys and
-- indexes are kept short on purpose: attendance is most of the rows, and the
-- Neon Free plan has 1 GB of storage (measured in docs/timeline.md).
-- Who did what stays in audit_events; this table is what happened to the person.
CREATE TYPE "public"."person_event_type" AS ENUM('attendance', 'incidencia', 'vacation', 'receipt', 'document', 'employment');--> statement-breakpoint
CREATE TABLE "person_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"type" "person_event_type" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"dedupe_key" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "person_events_attendance_dedupe_check" CHECK ("type" <> 'attendance' OR ("dedupe_key" IS NOT NULL AND "dedupe_key" ~ '^attendance:[0-9]{4}-[0-9]{2}-[0-9]{2}$')),
	CONSTRAINT "person_events_source_check" CHECK (char_length("source") BETWEEN 1 AND 64),
	CONSTRAINT "person_events_dedupe_key_check" CHECK ("dedupe_key" IS NULL OR char_length("dedupe_key") BETWEEN 1 AND 200),
	CONSTRAINT "person_events_payload_check" CHECK (jsonb_typeof("payload") = 'object' AND pg_column_size("payload") <= 4096)
);
--> statement-breakpoint
ALTER TABLE "person_events" ADD CONSTRAINT "person_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_events" ADD CONSTRAINT "person_events_company_person_fk" FOREIGN KEY ("company_id","person_id") REFERENCES "public"."people"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "person_events_person_time_idx" ON "person_events" USING btree ("company_id","person_id","occurred_at" DESC,"id" DESC);--> statement-breakpoint
CREATE INDEX "person_events_site_day_idx" ON "person_events" USING btree ("company_id",("payload" ->> 'site_id'),"occurred_at") WHERE "type" in ('attendance', 'incidencia');--> statement-breakpoint
CREATE UNIQUE INDEX "person_events_dedupe_unique" ON "person_events" USING btree ("person_id","dedupe_key") WHERE "dedupe_key" is not null;--> statement-breakpoint
ALTER TABLE "person_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "person_events_company_isolation" ON "person_events" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
-- Append-only for the app: it may read, insert and (for retention and ARCO)
-- delete, never update. The default privileges of 0018 grant UPDATE too, so it
-- is revoked here.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT SELECT, INSERT, DELETE ON "person_events" TO workia_app;
		REVOKE UPDATE ON "person_events" FROM workia_app;
	END IF;
END $$;

-- Rollback (by hand; nothing else references this table):
--   DROP POLICY "person_events_company_isolation" ON "person_events";
--   DROP TABLE "person_events";
--   DROP TYPE "person_event_type";
--   DELETE FROM drizzle.applied_migrations WHERE tag = '0031_person_events';
