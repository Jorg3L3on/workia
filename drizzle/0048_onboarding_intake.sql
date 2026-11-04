-- Workia 2.0 W2-10. Alta por autoservicio: RH abre un formulario desde un alta
-- en «Captura RH», la persona llena sus datos personales y del expediente
-- México desde /mi y RH los revisa y los aplica al expediente. La persona
-- nunca escribe la fila de people: sus valores esperan aquí (data, jsonb
-- pequeño) hasta que RH los aplica. Sin archivos: los documentos van por
-- person_documents y el almacenamiento de objetos (W2-04).
--
-- El motivo de devolución es un código de una lista cerrada, sin texto libre.
-- fields_total y fields_by_employee se guardan al aplicar: cuántos campos del
-- formulario llenó la persona (criterio de aceptación: 80 % o más).
ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_company_id_id_unique" UNIQUE("company_id","id");--> statement-breakpoint
CREATE TABLE "onboarding_intakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"onboarding_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"status" text DEFAULT 'invitado' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"return_reason" text,
	"fields_total" integer,
	"fields_by_employee" integer,
	"invited_by" uuid,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_by_account_id" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_intakes_status_check" CHECK ("onboarding_intakes"."status" IN ('invitado', 'enviado', 'devuelto', 'aplicado')),
	CONSTRAINT "onboarding_intakes_return_reason_check" CHECK (("onboarding_intakes"."status" = 'devuelto') = ("onboarding_intakes"."return_reason" IS NOT NULL) AND ("onboarding_intakes"."return_reason" IS NULL OR "onboarding_intakes"."return_reason" IN ('incompleto', 'datos_incorrectos', 'identificador_duplicado'))),
	CONSTRAINT "onboarding_intakes_submitted_check" CHECK ("onboarding_intakes"."status" NOT IN ('enviado', 'aplicado') OR "onboarding_intakes"."submitted_at" IS NOT NULL),
	CONSTRAINT "onboarding_intakes_applied_check" CHECK (("onboarding_intakes"."status" = 'aplicado') = ("onboarding_intakes"."fields_total" IS NOT NULL) AND ("onboarding_intakes"."fields_total" IS NULL) = ("onboarding_intakes"."fields_by_employee" IS NULL) AND ("onboarding_intakes"."fields_by_employee" IS NULL OR "onboarding_intakes"."fields_by_employee" BETWEEN 0 AND "onboarding_intakes"."fields_total"))
);
--> statement-breakpoint
ALTER TABLE "onboarding_intakes" ADD CONSTRAINT "onboarding_intakes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_intakes" ADD CONSTRAINT "onboarding_intakes_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_intakes" ADD CONSTRAINT "onboarding_intakes_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_intakes" ADD CONSTRAINT "onboarding_intakes_company_onboarding_fk" FOREIGN KEY ("company_id","onboarding_id") REFERENCES "public"."onboardings"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_intakes" ADD CONSTRAINT "onboarding_intakes_company_person_fk" FOREIGN KEY ("company_id","person_id") REFERENCES "public"."people"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_intakes" ADD CONSTRAINT "onboarding_intakes_company_submitted_by_fk" FOREIGN KEY ("company_id","submitted_by_account_id") REFERENCES "public"."employee_accounts"("company_id","id") ON DELETE SET NULL ("submitted_by_account_id") ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_intakes_onboarding_unique" ON "onboarding_intakes" USING btree ("company_id","onboarding_id");--> statement-breakpoint
CREATE INDEX "onboarding_intakes_company_person_idx" ON "onboarding_intakes" USING btree ("company_id","person_id");--> statement-breakpoint
ALTER TABLE "onboarding_intakes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "onboarding_intakes_company_isolation" ON "onboarding_intakes" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "onboarding_intakes" TO workia_app;
	END IF;
END $$;

-- Rollback (by hand; nothing outside this migration references these objects):
--   DROP TABLE "onboarding_intakes";
--   ALTER TABLE "onboardings" DROP CONSTRAINT "onboardings_company_id_id_unique";
--   DELETE FROM drizzle.applied_migrations WHERE tag = '0048_onboarding_intake';
