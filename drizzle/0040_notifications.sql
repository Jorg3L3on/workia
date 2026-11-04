-- Workia 2.0 W2-08. Notifications (docs/notificaciones.md): email, web push and an
-- in-app inbox, at no cost (no WhatsApp, no SMS). A notification row is the inbox entry
-- of one recipient (a person in the employee app, or an HR user); its delivery log has
-- one row per channel, retried with backoff; push subscriptions are the employee's
-- devices; opt-outs turn email or push off per recipient. Every table belongs to one
-- company, under the same RLS as the rest.
-- Only additive statements: new tables, indexes and a function.
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"recipient_person_id" uuid,
	"recipient_user_id" uuid,
	"template" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"url" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "notifications_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "notifications_one_recipient_check" CHECK (("notifications"."recipient_person_id" IS NULL) <> ("notifications"."recipient_user_id" IS NULL)),
	CONSTRAINT "notifications_template_check" CHECK ("notifications"."template" IN ('receipt_available', 'request_decision', 'document_rejected', 'contract_ending', 'request_pending')),
	CONSTRAINT "notifications_url_check" CHECK ("notifications"."url" IS NULL OR ("notifications"."url" LIKE '/%' AND "notifications"."url" NOT LIKE '//%'))
);--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"notification_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_channel_check" CHECK ("notification_deliveries"."channel" IN ('in_app', 'email', 'push')),
	CONSTRAINT "notification_deliveries_status_check" CHECK ("notification_deliveries"."status" IN ('pending', 'sent', 'failed', 'skipped')),
	CONSTRAINT "notification_deliveries_pending_check" CHECK (("notification_deliveries"."status" = 'pending') = ("notification_deliveries"."next_attempt_at" IS NOT NULL)),
	CONSTRAINT "notification_deliveries_attempts_check" CHECK ("notification_deliveries"."attempts" >= 0)
);--> statement-breakpoint
CREATE TABLE "notification_opt_outs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"recipient_person_id" uuid,
	"recipient_user_id" uuid,
	"channel" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_opt_outs_one_recipient_check" CHECK (("notification_opt_outs"."recipient_person_id" IS NULL) <> ("notification_opt_outs"."recipient_user_id" IS NULL)),
	CONSTRAINT "notification_opt_outs_channel_check" CHECK ("notification_opt_outs"."channel" IN ('email', 'push'))
);--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	CONSTRAINT "push_subscriptions_endpoint_check" CHECK ("push_subscriptions"."endpoint" LIKE 'https://%')
);--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_company_notification_fk" FOREIGN KEY ("company_id","notification_id") REFERENCES "public"."notifications"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_opt_outs" ADD CONSTRAINT "notification_opt_outs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_opt_outs" ADD CONSTRAINT "notification_opt_outs_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_opt_outs" ADD CONSTRAINT "notification_opt_outs_company_person_fk" FOREIGN KEY ("company_id","recipient_person_id") REFERENCES "public"."people"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_company_person_fk" FOREIGN KEY ("company_id","recipient_person_id") REFERENCES "public"."people"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_company_person_fk" FOREIGN KEY ("company_id","person_id") REFERENCES "public"."people"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_notification_channel_unique" ON "notification_deliveries" USING btree ("notification_id","channel");--> statement-breakpoint
CREATE INDEX "notification_deliveries_due_idx" ON "notification_deliveries" USING btree ("company_id","next_attempt_at") WHERE "notification_deliveries"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "notification_opt_outs_person_channel_unique" ON "notification_opt_outs" USING btree ("company_id","recipient_person_id","channel") WHERE "notification_opt_outs"."recipient_person_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_opt_outs_user_channel_unique" ON "notification_opt_outs" USING btree ("company_id","recipient_user_id","channel") WHERE "notification_opt_outs"."recipient_user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notifications_person_inbox_idx" ON "notifications" USING btree ("company_id","recipient_person_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "notifications"."recipient_person_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notifications_user_inbox_idx" ON "notifications" USING btree ("company_id","recipient_user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "notifications"."recipient_user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_unique" ON "notifications" USING btree ("company_id","dedupe_key") WHERE "notifications"."dedupe_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notifications_company_created_at_idx" ON "notifications" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_company_endpoint_unique" ON "push_subscriptions" USING btree ("company_id","endpoint");--> statement-breakpoint
CREATE INDEX "push_subscriptions_company_person_idx" ON "push_subscriptions" USING btree ("company_id","person_id");--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "notifications_company_isolation" ON "notifications" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "notification_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "notification_deliveries_company_isolation" ON "notification_deliveries" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "push_subscriptions_company_isolation" ON "push_subscriptions" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "notification_opt_outs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "notification_opt_outs_company_isolation" ON "notification_opt_outs" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
-- The retry sweep (/api/cron/notifications) runs without a company. This function only
-- answers «which companies have a delivery due», like employee_credential_company (0030);
-- the sweep then claims and sends each company's rows under RLS scoped to it.
CREATE FUNCTION "notification_due_companies"("max_companies" integer) RETURNS SETOF uuid
	LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
	AS $$
		SELECT DISTINCT company_id FROM notification_deliveries
		WHERE status = 'pending' AND next_attempt_at <= now()
		LIMIT max_companies
	$$;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "notifications", "notification_deliveries", "push_subscriptions", "notification_opt_outs" TO workia_app;
		GRANT EXECUTE ON FUNCTION "notification_due_companies"(integer) TO workia_app;
	END IF;
END $$;

-- Rollback (by hand; nothing outside this migration references these objects):
--   DROP FUNCTION "notification_due_companies"(integer);
--   DROP TABLE "notification_deliveries"; DROP TABLE "notification_opt_outs";
--   DROP TABLE "push_subscriptions"; DROP TABLE "notifications";
--   DELETE FROM drizzle.applied_migrations WHERE tag = '0040_notifications';
