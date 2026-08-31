CREATE TABLE "person_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"entrada" text,
	"salida_comer" text,
	"regreso_comer" text,
	"salida" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_schedules_person_id_unique" UNIQUE("person_id")
);
--> statement-breakpoint
ALTER TABLE "person_schedules" ADD CONSTRAINT "person_schedules_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "person_schedules_person_id_idx" ON "person_schedules" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "person_schedules_deleted_at_idx" ON "person_schedules" USING btree ("deleted_at");--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "schedule_entrada" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "schedule_salida_comer" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "schedule_regreso_comer" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "schedule_salida" text;
