-- Workia 2.0 W2-24. Transfers between subsidiaries (docs/transfers.md,
-- docs/identity-model.md). A transfer closes the person's period in one
-- company and opens one in another, on a row of that company, and links the
-- two rows by id. One transfer is two person_links rows, one per company,
-- sharing transfer_id, so each company sees its own side under its own RLS
-- policy. No CURP column: the flow checks that both rows carry the same CURP.
-- Also: the «traslado» tipo de baja the transfer writes, and the group admin
-- grant that may read linked rows in every company.
ALTER TYPE "public"."termination_type" ADD VALUE IF NOT EXISTS 'traslado';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_group_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TYPE "public"."person_link_direction" AS ENUM('out', 'in');--> statement-breakpoint
CREATE TABLE "person_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"linked_company_id" uuid NOT NULL,
	"linked_person_id" uuid NOT NULL,
	"transfer_id" uuid NOT NULL,
	"direction" "person_link_direction" NOT NULL,
	"transfer_date" date NOT NULL,
	"employment_period_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_links_transfer_company_unique" UNIQUE("transfer_id","company_id"),
	CONSTRAINT "person_links_period_unique" UNIQUE("company_id","employment_period_id","direction"),
	CONSTRAINT "person_links_other_company_check" CHECK ("company_id" <> "linked_company_id")
);
--> statement-breakpoint
ALTER TABLE "person_links" ADD CONSTRAINT "person_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_links" ADD CONSTRAINT "person_links_linked_company_id_companies_id_fk" FOREIGN KEY ("linked_company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_links" ADD CONSTRAINT "person_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_links" ADD CONSTRAINT "person_links_company_person_fk" FOREIGN KEY ("company_id","person_id") REFERENCES "public"."people"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_links" ADD CONSTRAINT "person_links_linked_person_fk" FOREIGN KEY ("linked_company_id","linked_person_id") REFERENCES "public"."people"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_links" ADD CONSTRAINT "person_links_company_period_fk" FOREIGN KEY ("company_id","employment_period_id") REFERENCES "public"."employment_periods"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "person_links_company_person_idx" ON "person_links" USING btree ("company_id","person_id");--> statement-breakpoint
ALTER TABLE "person_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "person_links_company_isolation" ON "person_links" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
-- A link is a fact: the app reads and inserts it, never changes or deletes it
-- (a hard-deleted person takes its links with it through the foreign keys).
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT SELECT, INSERT ON "person_links" TO workia_app;
		REVOKE UPDATE, DELETE ON "person_links" FROM workia_app;
	END IF;
END $$;

-- Rollback (by hand; only after no period has tipo_baja 'traslado'):
--   DROP POLICY "person_links_company_isolation" ON "person_links";
--   DROP TABLE "person_links";
--   DROP TYPE "person_link_direction";
--   ALTER TABLE "users" DROP COLUMN "is_group_admin";
--   (an enum value cannot be dropped; 'traslado' stays unused)
--   DELETE FROM drizzle.applied_migrations WHERE tag = '0046_person_links';
