-- Workia 2.0 W2-02. Mi expediente correction requests (docs/mi-expediente.md).
-- The employee proposes a new value for one field of their own record; HR sees the
-- before and after in its «Correcciones» inbox, fixes the record in the person form
-- and marks the request applied, or rejects it with a reason. A business table of one
-- company, under the same RLS as the rest. Only additive statements.
CREATE TABLE "profile_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"field" text NOT NULL,
	"current_value" text,
	"proposed_value" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_corrections_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "profile_corrections_status_check" CHECK ("status" IN ('pendiente', 'aplicada', 'rechazada', 'cancelada')),
	CONSTRAINT "profile_corrections_field_check" CHECK ("field" ~ '^[a-zA-Z]{1,40}$'),
	CONSTRAINT "profile_corrections_proposed_value_check" CHECK (length(btrim("proposed_value")) BETWEEN 1 AND 300),
	CONSTRAINT "profile_corrections_note_check" CHECK ("note" IS NULL OR length("note") <= 500),
	CONSTRAINT "profile_corrections_decided_check" CHECK (("status" = 'pendiente') = ("decided_at" IS NULL)),
	CONSTRAINT "profile_corrections_reason_check" CHECK (("status" <> 'rechazada' OR length(btrim(coalesce("decision_reason", ''))) > 0) AND ("decision_reason" IS NULL OR length("decision_reason") <= 500))
);--> statement-breakpoint
ALTER TABLE "profile_corrections" ADD CONSTRAINT "profile_corrections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_corrections" ADD CONSTRAINT "profile_corrections_company_person_fk" FOREIGN KEY ("company_id","person_id") REFERENCES "public"."people"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_corrections" ADD CONSTRAINT "profile_corrections_company_account_fk" FOREIGN KEY ("company_id","account_id") REFERENCES "public"."employee_accounts"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_corrections" ADD CONSTRAINT "profile_corrections_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profile_corrections_pending_field_unique" ON "profile_corrections" USING btree ("company_id","person_id","field") WHERE "profile_corrections"."status" = 'pendiente';--> statement-breakpoint
CREATE INDEX "profile_corrections_inbox_idx" ON "profile_corrections" USING btree ("company_id","created_at","id") WHERE "profile_corrections"."status" = 'pendiente';--> statement-breakpoint
CREATE INDEX "profile_corrections_company_person_idx" ON "profile_corrections" USING btree ("company_id","person_id","created_at");--> statement-breakpoint
ALTER TABLE "profile_corrections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "profile_corrections_company_isolation" ON "profile_corrections" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
--
-- Rollback (by hand, before anything reads it):
--   DROP TABLE "profile_corrections";
