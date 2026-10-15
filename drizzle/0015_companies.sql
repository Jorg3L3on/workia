-- WRK-I4-3: companies, memberships with a role per company, platform admins.
-- Re-runnable: every statement checks before it creates or inserts.
DO $$ BEGIN
	CREATE TYPE "public"."company_status" AS ENUM('activa', 'suspendida');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE "public"."membership_status" AS ENUM('activa', 'revocada');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"rfc" text,
	"slug" text NOT NULL,
	"status" "company_status" DEFAULT 'activa' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "companies_slug_unique" ON "companies" USING btree ("slug");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"status" "membership_status" DEFAULT 'activa' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "company_memberships_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action,
	CONSTRAINT "company_memberships_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_memberships_user_company_unique" ON "company_memberships" USING btree ("user_id","company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_memberships_user_default_unique" ON "company_memberships" USING btree ("user_id") WHERE "company_memberships"."is_default";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_memberships_company_id_idx" ON "company_memberships" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_memberships_role_id_idx" ON "company_memberships" USING btree ("role_id");--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_platform_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- The company every existing row belongs to.
INSERT INTO "companies" ("name", "slug") VALUES ('Ferretera Mandiola', 'ferretera-mandiola')
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint
-- Each user keeps their role, now as a membership of the default company.
-- A user with several global roles keeps the broadest one.
INSERT INTO "company_memberships" ("user_id", "company_id", "role_id", "is_default")
SELECT DISTINCT ON ("user_roles"."user_id") "user_roles"."user_id", "companies"."id", "user_roles"."role_id", true
FROM "user_roles"
INNER JOIN "roles" ON "roles"."id" = "user_roles"."role_id"
CROSS JOIN "companies"
WHERE "companies"."slug" = 'ferretera-mandiola'
ORDER BY "user_roles"."user_id",
	CASE "roles"."slug" WHEN 'super_admin' THEN 0 WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 WHEN 'viewer' THEN 3 ELSE 4 END
ON CONFLICT ("user_id", "company_id") DO NOTHING;--> statement-breakpoint
-- data-loss-ok: only turns is_platform_admin on (a column this migration adds) for super_admins; nothing is overwritten.
UPDATE "users" SET "is_platform_admin" = true
WHERE "is_platform_admin" = false
	AND "id" IN (
		SELECT "user_roles"."user_id" FROM "user_roles"
		INNER JOIN "roles" ON "roles"."id" = "user_roles"."role_id"
		WHERE "roles"."slug" = 'super_admin'
	);
