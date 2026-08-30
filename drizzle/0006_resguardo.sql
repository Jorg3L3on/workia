CREATE TYPE "public"."asset_status" AS ENUM('disponible', 'asignado', 'baja');--> statement-breakpoint
CREATE TYPE "public"."asset_movement_type" AS ENUM('entrega', 'devolucion');--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"identifier" text NOT NULL,
	"category" text NOT NULL,
	"tracks_history" boolean DEFAULT true NOT NULL,
	"holder_id" uuid,
	"condition_note" text,
	"status" "asset_status" DEFAULT 'disponible' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"type" "asset_movement_type" NOT NULL,
	"person_id" uuid NOT NULL,
	"movement_date" date NOT NULL,
	"condition_note" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_holder_id_people_id_fk" FOREIGN KEY ("holder_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_identifier_idx" ON "assets" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "assets_holder_id_idx" ON "assets" USING btree ("holder_id");--> statement-breakpoint
CREATE INDEX "assets_status_idx" ON "assets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "assets_deleted_at_idx" ON "assets" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "asset_movements_asset_id_idx" ON "asset_movements" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_movements_person_id_idx" ON "asset_movements" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "asset_movements_movement_date_idx" ON "asset_movements" USING btree ("movement_date");
