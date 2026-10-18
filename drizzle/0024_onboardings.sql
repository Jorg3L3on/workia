-- WRK-I5-7: hiring (alta) from HR to Payroll with two approvals. One process per person:
-- rh_captura → pendiente_nominas → completo, or rechazado with a reason. The checklist and
-- the Infonavit/Fonacot data live on the row; who approved each stage is kept so the same
-- user cannot approve both (checked in the domain and by a constraint).
CREATE TYPE "public"."onboarding_stage" AS ENUM('rh_captura', 'pendiente_nominas', 'completo', 'rechazado');--> statement-breakpoint
CREATE TABLE "onboardings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"stage" "onboarding_stage" DEFAULT 'rh_captura' NOT NULL,
	"checklist" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"infonavit_credito" text,
	"infonavit_tipo_descuento" text,
	"infonavit_factor" numeric(12, 4),
	"fonacot_credito" text,
	"fonacot_descuento" numeric(12, 2),
	"rh_approved_by" uuid,
	"rh_approved_at" timestamp with time zone,
	"payroll_approved_by" uuid,
	"payroll_approved_at" timestamp with time zone,
	"rejected_by" uuid,
	"rejected_at" timestamp with time zone,
	"rejected_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboardings_company_person_unique" UNIQUE("company_id","person_id"),
	CONSTRAINT "onboardings_two_approvers" CHECK ("payroll_approved_by" IS NULL OR "rh_approved_by" IS NULL OR "payroll_approved_by" <> "rh_approved_by"),
	CONSTRAINT "onboardings_infonavit_tipo_check" CHECK ("infonavit_tipo_descuento" IS NULL OR "infonavit_tipo_descuento" IN ('porcentaje', 'cuota_fija', 'veces_salario_minimo'))
);--> statement-breakpoint
ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_company_person_fk" FOREIGN KEY ("company_id","person_id") REFERENCES "public"."people"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_rh_approved_by_users_id_fk" FOREIGN KEY ("rh_approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_payroll_approved_by_users_id_fk" FOREIGN KEY ("payroll_approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "onboardings_company_stage_idx" ON "onboardings" USING btree ("company_id","stage");--> statement-breakpoint
ALTER TABLE "onboardings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "onboardings_company_isolation" ON "onboardings" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "onboardings" TO workia_app;
	END IF;
END $$;
