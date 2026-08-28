CREATE TYPE "public"."contract_type" AS ENUM('determinado', 'indeterminado');--> statement-breakpoint
CREATE TYPE "public"."contract_notice_window" AS ENUM('1', '2', '3', '6', 'no_avisar');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('vigente', 'renovado', 'no_renovado', 'vencido');--> statement-breakpoint
CREATE TABLE "contract_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"type" "contract_type" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"notice_window" "contract_notice_window" DEFAULT 'no_avisar' NOT NULL,
	"template_id" uuid,
	"template_name" text,
	"generated_text" text NOT NULL,
	"status" "contract_status" DEFAULT 'vigente' NOT NULL,
	"previous_contract_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_template_id_contract_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."contract_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_previous_contract_id_contracts_id_fk" FOREIGN KEY ("previous_contract_id") REFERENCES "public"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_templates_active_idx" ON "contract_templates" USING btree ("active");--> statement-breakpoint
CREATE INDEX "contract_templates_deleted_at_idx" ON "contract_templates" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "contracts_person_id_idx" ON "contracts" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "contracts_status_idx" ON "contracts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "contracts_end_date_idx" ON "contracts" USING btree ("end_date");--> statement-breakpoint
CREATE INDEX "contracts_deleted_at_idx" ON "contracts" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "contracts_vigente_person_idx" ON "contracts" USING btree ("person_id") WHERE "status" = 'vigente' AND "deleted_at" IS NULL;
