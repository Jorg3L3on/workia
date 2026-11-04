-- Workia 2.0 W2-01. Employee accounts (docs/identity-model.md, docs/employee-accounts.md).
-- An account points at one people row (company_id, person_id) and is invited by HR,
-- activated by the employee and disabled by a baja or a borrado. Sessions and one-time
-- codes are rows, stored as an HMAC, so a baja can revoke them the same day. Every
-- table is a business table of one company, under the same RLS as the rest.
-- audit_events gains the account as an actor for what an employee does.
-- Only additive statements: new tables, a nullable column, indexes and a function.
CREATE TABLE "employee_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"status" text DEFAULT 'invited' NOT NULL,
	"email" text,
	"email_verified_at" timestamp with time zone,
	"password_hash" text,
	"invited_by" uuid,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"disabled_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_accounts_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "employee_accounts_status_check" CHECK ("status" IN ('invited', 'active', 'disabled')),
	CONSTRAINT "employee_accounts_disabled_check" CHECK (("status" = 'disabled') = ("disabled_at" IS NOT NULL)),
	CONSTRAINT "employee_accounts_disabled_reason_check" CHECK ("disabled_reason" IS NULL OR "disabled_reason" IN ('baja', 'borrado', 'rrhh')),
	CONSTRAINT "employee_accounts_email_check" CHECK ("email" IS NULL OR ("email" = lower(btrim("email")) AND "email" LIKE '%_@_%'))
);--> statement-breakpoint
ALTER TABLE "employee_accounts" ADD CONSTRAINT "employee_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_accounts" ADD CONSTRAINT "employee_accounts_company_person_fk" FOREIGN KEY ("company_id","person_id") REFERENCES "public"."people"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_accounts" ADD CONSTRAINT "employee_accounts_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_accounts_person_live_unique" ON "employee_accounts" USING btree ("company_id","person_id") WHERE "employee_accounts"."status" <> 'disabled';--> statement-breakpoint
CREATE UNIQUE INDEX "employee_accounts_email_live_unique" ON "employee_accounts" USING btree ("email") WHERE "employee_accounts"."status" <> 'disabled' AND "employee_accounts"."email" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "employee_accounts_company_person_idx" ON "employee_accounts" USING btree ("company_id","person_id");--> statement-breakpoint
CREATE TABLE "employee_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
ALTER TABLE "employee_sessions" ADD CONSTRAINT "employee_sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_sessions" ADD CONSTRAINT "employee_sessions_company_account_fk" FOREIGN KEY ("company_id","account_id") REFERENCES "public"."employee_accounts"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_sessions_token_hash_unique" ON "employee_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "employee_sessions_company_account_idx" ON "employee_sessions" USING btree ("company_id","account_id");--> statement-breakpoint
CREATE INDEX "employee_sessions_expires_at_idx" ON "employee_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE TABLE "employee_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_codes_purpose_check" CHECK ("purpose" IN ('login', 'activation')),
	CONSTRAINT "employee_codes_attempts_check" CHECK ("attempts" >= 0)
);--> statement-breakpoint
ALTER TABLE "employee_codes" ADD CONSTRAINT "employee_codes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_codes" ADD CONSTRAINT "employee_codes_company_account_fk" FOREIGN KEY ("company_id","account_id") REFERENCES "public"."employee_accounts"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_codes" ADD CONSTRAINT "employee_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_codes_company_account_purpose_idx" ON "employee_codes" USING btree ("company_id","account_id","purpose");--> statement-breakpoint
CREATE INDEX "employee_codes_expires_at_idx" ON "employee_codes" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "actor_employee_account_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_employee_account_id_employee_accounts_id_fk" FOREIGN KEY ("actor_employee_account_id") REFERENCES "public"."employee_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_actor_employee_account_id_idx" ON "audit_events" USING btree ("actor_employee_account_id");--> statement-breakpoint
ALTER TABLE "employee_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "employee_accounts_company_isolation" ON "employee_accounts" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "employee_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "employee_sessions_company_isolation" ON "employee_sessions" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "employee_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "employee_codes_company_isolation" ON "employee_codes" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
-- Sign-in arrives before anyone knows the company, like an MCP bearer token (0009).
-- This function only answers «which company holds this credential»: a normalized
-- email or a CURP with a live account, or a live session token hash. The app then
-- reads the account under RLS scoped to that company. It runs as the owner, outside
-- RLS, and returns nothing else. The same answer tells an invitation that an email
-- or a CURP already has a live account in some company (one per CURP, group-wide).
CREATE FUNCTION "employee_credential_company"("kind" text, "lookup" text) RETURNS uuid
	LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
	AS $$
		SELECT company_id FROM employee_accounts
		WHERE kind = 'email' AND email = lookup AND status <> 'disabled'
		UNION ALL
		SELECT a.company_id FROM employee_accounts a
		JOIN people p ON p.company_id = a.company_id AND p.id = a.person_id
		WHERE kind = 'curp' AND p.curp = lookup AND p.deleted_at IS NULL AND a.status <> 'disabled'
		UNION ALL
		SELECT company_id FROM employee_sessions
		WHERE kind = 'session' AND token_hash = lookup AND expires_at > now()
		LIMIT 1
	$$;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "employee_accounts", "employee_sessions", "employee_codes" TO workia_app;
		GRANT EXECUTE ON FUNCTION "employee_credential_company"(text, text) TO workia_app;
	END IF;
END $$;

-- Rollback (by hand; nothing outside this migration references these objects):
--   ALTER TABLE "audit_events" DROP COLUMN "actor_employee_account_id";
--   DROP FUNCTION "employee_credential_company"(text, text);
--   DROP TABLE "employee_codes"; DROP TABLE "employee_sessions"; DROP TABLE "employee_accounts";
--   DELETE FROM drizzle.applied_migrations WHERE tag = '0030_employee_accounts';
