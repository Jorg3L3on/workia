-- Workia 2.0 W2-19. LFT alerts: Workia warns HR and the manager before a
-- legal threshold becomes a case (faltas of LFT article 47, section X; a
-- contract ending; a document expiring). The message goes through the W2-08
-- notifications (in-app, email, web push); this table is the record that the
-- alert was sent, kept after the inbox retention. Small: one row per alert.
-- No triggers.
CREATE TABLE "lft_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"subject_key" text NOT NULL,
	"due_on" date NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"hr_recipients" smallint DEFAULT 0 NOT NULL,
	"manager_notified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lft_alerts_subject_key" UNIQUE("company_id","kind","subject_key"),
	CONSTRAINT "lft_alerts_kind_check" CHECK ("lft_alerts"."kind" IN ('absence_warning', 'absence_threshold', 'contract_ending', 'document_expiring')),
	CONSTRAINT "lft_alerts_subject_key_check" CHECK (char_length("lft_alerts"."subject_key") BETWEEN 1 AND 120),
	CONSTRAINT "lft_alerts_hr_recipients_check" CHECK ("lft_alerts"."hr_recipients" >= 0)
);
--> statement-breakpoint
CREATE TABLE "lft_alert_runs" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"last_run_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lft_alerts" ADD CONSTRAINT "lft_alerts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lft_alerts" ADD CONSTRAINT "lft_alerts_company_person_fk" FOREIGN KEY ("company_id","person_id") REFERENCES "public"."people"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lft_alert_runs" ADD CONSTRAINT "lft_alert_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lft_alerts_company_created_idx" ON "lft_alerts" USING btree ("company_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "lft_alerts_company_person_kind_due_idx" ON "lft_alerts" USING btree ("company_id","person_id","kind","due_on");--> statement-breakpoint
ALTER TABLE "lft_alerts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lft_alert_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "lft_alerts_company_isolation" ON "lft_alerts" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "lft_alert_runs_company_isolation" ON "lft_alert_runs" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
-- The three LFT templates of the notifications inbox.
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_template_check";--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_template_check" CHECK ("notifications"."template" IN ('receipt_available', 'request_decision', 'document_rejected', 'contract_ending', 'request_pending', 'absence_warning', 'absence_threshold', 'document_expiring'));--> statement-breakpoint
-- The alert log is append-only for the app: no UPDATE, no DELETE.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT SELECT, INSERT ON "lft_alerts" TO workia_app;
		REVOKE UPDATE, DELETE ON "lft_alerts" FROM workia_app;
		GRANT SELECT, INSERT, UPDATE ON "lft_alert_runs" TO workia_app;
		REVOKE DELETE ON "lft_alert_runs" FROM workia_app;
	END IF;
END $$;

-- Rollback (by hand; nothing else references these tables):
--   DELETE FROM notifications WHERE template IN ('absence_warning', 'absence_threshold', 'document_expiring');
--   ALTER TABLE notifications DROP CONSTRAINT notifications_template_check;
--   ALTER TABLE notifications ADD CONSTRAINT notifications_template_check CHECK (template IN ('receipt_available', 'request_decision', 'document_rejected', 'contract_ending', 'request_pending'));
--   DROP TABLE "lft_alert_runs";
--   DROP TABLE "lft_alerts";
--   DELETE FROM drizzle.applied_migrations WHERE tag = '0053_lft_alerts';
