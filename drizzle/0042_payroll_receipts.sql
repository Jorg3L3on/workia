-- W2-03 (Workia 2.0). Nómina receipts: the CFDI the payroll provider stamped,
-- delivered to each employee. Workia never computes payroll or stores
-- amounts; these tables hold who a receipt belongs to, the identifiers used
-- to match it and when it was delivered and first opened. The PDF and XML
-- live in object storage (src/lib/storage), never in the database.
--
-- payroll_periods: one pay period per company; draft while HR imports and
--   fixes unmatched receipts, published when they are delivered.
-- payroll_receipts: one stamped CFDI; person_id null while unmatched.
-- payroll_employee_numbers: the provider's NumEmpleado per person, learned
--   from matched receipts, so the next period matches by number.
CREATE TABLE "payroll_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"label" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_periods_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "payroll_periods_company_label_unique" UNIQUE("company_id","label"),
	CONSTRAINT "payroll_periods_status_check" CHECK ("payroll_periods"."status" IN ('draft', 'published')),
	CONSTRAINT "payroll_periods_label_check" CHECK (char_length("payroll_periods"."label") BETWEEN 1 AND 80),
	CONSTRAINT "payroll_periods_dates_check" CHECK ("payroll_periods"."period_end" >= "payroll_periods"."period_start"),
	CONSTRAINT "payroll_periods_published_check" CHECK (("payroll_periods"."status" = 'published') = ("payroll_periods"."published_at" IS NOT NULL))
);--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payroll_periods_company_end_idx" ON "payroll_periods" USING btree ("company_id","period_end");--> statement-breakpoint
ALTER TABLE "payroll_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "payroll_periods_company_isolation" ON "payroll_periods" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "payroll_periods" TO workia_app;
	END IF;
END $$;--> statement-breakpoint
CREATE TABLE "payroll_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"person_id" uuid,
	"match_kind" text,
	"cfdi_uuid" uuid NOT NULL,
	"receptor_rfc" text NOT NULL,
	"receptor_curp" text,
	"receptor_num_empleado" text,
	"receptor_name" text,
	"payment_date" date,
	"xml_key" text NOT NULL,
	"xml_bytes" integer NOT NULL,
	"pdf_key" text,
	"pdf_bytes" integer,
	"uploaded_by" uuid,
	"delivered_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_receipts_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "payroll_receipts_company_cfdi_unique" UNIQUE("company_id","cfdi_uuid"),
	CONSTRAINT "payroll_receipts_match_check" CHECK (("payroll_receipts"."person_id" IS NULL) = ("payroll_receipts"."match_kind" IS NULL)),
	CONSTRAINT "payroll_receipts_match_kind_check" CHECK ("payroll_receipts"."match_kind" IS NULL OR "payroll_receipts"."match_kind" IN ('curp', 'num_empleado', 'rfc', 'manual')),
	CONSTRAINT "payroll_receipts_delivered_check" CHECK ("payroll_receipts"."delivered_at" IS NULL OR "payroll_receipts"."person_id" IS NOT NULL),
	CONSTRAINT "payroll_receipts_opened_check" CHECK ("payroll_receipts"."opened_at" IS NULL OR "payroll_receipts"."delivered_at" IS NOT NULL),
	CONSTRAINT "payroll_receipts_pdf_check" CHECK (("payroll_receipts"."pdf_key" IS NULL) = ("payroll_receipts"."pdf_bytes" IS NULL)),
	CONSTRAINT "payroll_receipts_identifiers_check" CHECK (char_length("payroll_receipts"."receptor_rfc") <= 13 AND ("payroll_receipts"."receptor_curp" IS NULL OR char_length("payroll_receipts"."receptor_curp") = 18) AND ("payroll_receipts"."receptor_num_empleado" IS NULL OR char_length("payroll_receipts"."receptor_num_empleado") <= 15) AND ("payroll_receipts"."receptor_name" IS NULL OR char_length("payroll_receipts"."receptor_name") <= 254))
);--> statement-breakpoint
ALTER TABLE "payroll_receipts" ADD CONSTRAINT "payroll_receipts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_receipts" ADD CONSTRAINT "payroll_receipts_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_receipts" ADD CONSTRAINT "payroll_receipts_company_period_fk" FOREIGN KEY ("company_id","period_id") REFERENCES "public"."payroll_periods"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_receipts" ADD CONSTRAINT "payroll_receipts_company_person_fk" FOREIGN KEY ("company_id","person_id") REFERENCES "public"."people"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payroll_receipts_company_period_idx" ON "payroll_receipts" USING btree ("company_id","period_id");--> statement-breakpoint
CREATE INDEX "payroll_receipts_company_person_delivered_idx" ON "payroll_receipts" USING btree ("company_id","person_id","delivered_at" DESC NULLS LAST) WHERE "payroll_receipts"."person_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "payroll_receipts_company_isolation" ON "payroll_receipts" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "payroll_receipts" TO workia_app;
	END IF;
END $$;--> statement-breakpoint
CREATE TABLE "payroll_employee_numbers" (
	"company_id" uuid NOT NULL,
	"num_empleado" text NOT NULL,
	"person_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_employee_numbers_pkey" PRIMARY KEY("company_id","num_empleado"),
	CONSTRAINT "payroll_employee_numbers_num_check" CHECK (char_length("payroll_employee_numbers"."num_empleado") BETWEEN 1 AND 15)
);--> statement-breakpoint
ALTER TABLE "payroll_employee_numbers" ADD CONSTRAINT "payroll_employee_numbers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_employee_numbers" ADD CONSTRAINT "payroll_employee_numbers_company_person_fk" FOREIGN KEY ("company_id","person_id") REFERENCES "public"."people"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payroll_employee_numbers_company_person_idx" ON "payroll_employee_numbers" USING btree ("company_id","person_id");--> statement-breakpoint
ALTER TABLE "payroll_employee_numbers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "payroll_employee_numbers_company_isolation" ON "payroll_employee_numbers" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "payroll_employee_numbers" TO workia_app;
	END IF;
END $$;

-- Rollback (by hand, in this order; nothing else references these tables).
-- The files in object storage under <company>/receipts/ stay; delete them
-- with the bucket's own tools if the rollback is final.
--   DROP TABLE "payroll_employee_numbers";
--   DROP TABLE "payroll_receipts";
--   DROP TABLE "payroll_periods";
--   DELETE FROM drizzle.applied_migrations WHERE tag = '0042_payroll_receipts';
