-- Workia 2.0 W2-07: manager scope. A grant on an employee account opens «Mi equipo»;
-- the team is read live from people.manager_id, never stored. A delegation lets a
-- backup manager act for the team until its end date. See docs/managers.md.
CREATE TABLE "manager_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"include_indirect" boolean DEFAULT false NOT NULL,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "manager_grants_company_id_id_unique" UNIQUE("company_id","id")
);--> statement-breakpoint
CREATE TABLE "manager_delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"manager_account_id" uuid NOT NULL,
	"delegate_account_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "manager_delegations_dates_check" CHECK ("ends_on" >= "starts_on"),
	CONSTRAINT "manager_delegations_not_self_check" CHECK ("manager_account_id" <> "delegate_account_id")
);--> statement-breakpoint
ALTER TABLE "manager_grants" ADD CONSTRAINT "manager_grants_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_grants" ADD CONSTRAINT "manager_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_grants" ADD CONSTRAINT "manager_grants_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_grants" ADD CONSTRAINT "manager_grants_company_account_fk" FOREIGN KEY ("company_id","account_id") REFERENCES "public"."employee_accounts"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_delegations" ADD CONSTRAINT "manager_delegations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_delegations" ADD CONSTRAINT "manager_delegations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_delegations" ADD CONSTRAINT "manager_delegations_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_delegations" ADD CONSTRAINT "manager_delegations_company_manager_fk" FOREIGN KEY ("company_id","manager_account_id") REFERENCES "public"."employee_accounts"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_delegations" ADD CONSTRAINT "manager_delegations_company_delegate_fk" FOREIGN KEY ("company_id","delegate_account_id") REFERENCES "public"."employee_accounts"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "manager_grants_account_live_unique" ON "manager_grants" USING btree ("company_id","account_id") WHERE "manager_grants"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "manager_delegations_delegate_live_idx" ON "manager_delegations" USING btree ("company_id","delegate_account_id","ends_on") WHERE "manager_delegations"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "manager_delegations_manager_live_idx" ON "manager_delegations" USING btree ("company_id","manager_account_id","ends_on") WHERE "manager_delegations"."revoked_at" IS NULL;--> statement-breakpoint
ALTER TABLE "manager_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "manager_grants_company_isolation" ON "manager_grants" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "manager_delegations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "manager_delegations_company_isolation" ON "manager_delegations" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "manager_grants", "manager_delegations" TO workia_app;
	END IF;
END $$;

-- Rollback (by hand; nothing outside this migration references these tables):
--   DROP TABLE "manager_delegations"; DROP TABLE "manager_grants";
--   DELETE FROM drizzle.applied_migrations WHERE tag = '0039_manager_scope';
