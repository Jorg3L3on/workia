CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"action" text NOT NULL,
	"result" text DEFAULT 'success' NOT NULL,
	"source" text DEFAULT 'app' NOT NULL,
	"payload" jsonb,
	"request_meta" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events" USING btree ("occurred_at");
--> statement-breakpoint
CREATE INDEX "audit_events_resource_idx" ON "audit_events" USING btree ("resource_type","resource_id");
--> statement-breakpoint
CREATE INDEX "audit_events_actor_user_id_idx" ON "audit_events" USING btree ("actor_user_id");
--> statement-breakpoint
CREATE TABLE "areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"parent_area_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"area_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_parent_area_id_areas_id_fk" FOREIGN KEY ("parent_area_id") REFERENCES "public"."areas"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "areas_parent_area_id_idx" ON "areas" USING btree ("parent_area_id");
--> statement-breakpoint
CREATE INDEX "areas_deleted_at_idx" ON "areas" USING btree ("deleted_at");
--> statement-breakpoint
CREATE INDEX "positions_area_id_idx" ON "positions" USING btree ("area_id");
--> statement-breakpoint
CREATE INDEX "positions_deleted_at_idx" ON "positions" USING btree ("deleted_at");
--> statement-breakpoint
ALTER TABLE "people" RENAME COLUMN "given_name" TO "nombres";
--> statement-breakpoint
ALTER TABLE "people" RENAME COLUMN "family_name" TO "apellido_paterno";
--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "apellido_materno" text;
--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "telefono" text;
--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "fecha_nacimiento" date;
--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "fecha_ingreso" date;
--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "area_id" uuid;
--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "position_id" uuid;
--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "manager_id" uuid;
--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "rfc" text;
--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "curp" text;
--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "nss" text;
--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "deleted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_manager_id_people_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
DROP INDEX "people_family_name_idx";
--> statement-breakpoint
CREATE INDEX "people_apellido_paterno_idx" ON "people" USING btree ("apellido_paterno");
--> statement-breakpoint
CREATE INDEX "people_deleted_at_idx" ON "people" USING btree ("deleted_at");
--> statement-breakpoint
CREATE INDEX "people_area_id_idx" ON "people" USING btree ("area_id");
--> statement-breakpoint
CREATE INDEX "people_position_id_idx" ON "people" USING btree ("position_id");
--> statement-breakpoint
CREATE INDEX "people_manager_id_idx" ON "people" USING btree ("manager_id");
