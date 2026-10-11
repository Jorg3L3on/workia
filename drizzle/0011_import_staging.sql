CREATE TYPE "public"."import_job_status" AS ENUM('uploading', 'validating', 'in_review', 'applying', 'applied', 'failed', 'undone');--> statement-breakpoint
CREATE TYPE "public"."import_job_type" AS ENUM('people');--> statement-breakpoint
CREATE TYPE "public"."import_row_action" AS ENUM('pending', 'create', 'update', 'unchanged', 'error');--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "import_job_type" DEFAULT 'people' NOT NULL,
	"status" "import_job_status" DEFAULT 'uploading' NOT NULL,
	"file_name" text NOT NULL,
	"file_hash" text NOT NULL,
	"file_size_bytes" integer,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"failure_message" text,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	"undone_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"sheet" text NOT NULL,
	"row_number" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"normalized" jsonb,
	"action" "import_row_action" DEFAULT 'pending' NOT NULL,
	"errors" jsonb,
	"diff" jsonb,
	"target_person_id" uuid,
	"target_contract_id" uuid,
	"previous_snapshot" jsonb,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_job_id_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_target_person_id_people_id_fk" FOREIGN KEY ("target_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_target_contract_id_contracts_id_fk" FOREIGN KEY ("target_contract_id") REFERENCES "public"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_jobs_status_idx" ON "import_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "import_jobs_file_hash_idx" ON "import_jobs" USING btree ("file_hash");--> statement-breakpoint
CREATE INDEX "import_jobs_actor_user_id_idx" ON "import_jobs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "import_jobs_created_at_idx" ON "import_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_jobs_single_applying_idx" ON "import_jobs" USING btree ("type") WHERE "import_jobs"."status" = 'applying';--> statement-breakpoint
CREATE UNIQUE INDEX "import_rows_job_sheet_row_idx" ON "import_rows" USING btree ("job_id","sheet","row_number");--> statement-breakpoint
CREATE INDEX "import_rows_job_action_idx" ON "import_rows" USING btree ("job_id","action");--> statement-breakpoint
CREATE INDEX "import_rows_target_person_id_idx" ON "import_rows" USING btree ("target_person_id");
