CREATE TYPE "public"."site_kind" AS ENUM('corporativo', 'sucursal');--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "site_kind" NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sites_deleted_at_idx" ON "sites" USING btree ("deleted_at");
--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "site_id" uuid;
--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "people_site_id_idx" ON "people" USING btree ("site_id");
