-- Workia 2.0 W2-14. The incidencias engine turns each day's punches and the
-- schedule in effect into faltas, retardos and salidas anticipadas, written
-- to person_events through replacePeriodIncidencias (no table of its own for
-- them). This adds the two things HR decides: the rules (tolerances), which
-- start in a quincena, and the justifications (permisos, IMSS incapacidades
-- and overrides of one incidencia). Small tables: a row per rules change and
-- one per decision. No triggers.
CREATE TABLE "incidencia_rules" (
	"company_id" uuid NOT NULL,
	"effective_period" text NOT NULL,
	"retardo_tolerance_minutes" smallint NOT NULL,
	"salida_tolerance_minutes" smallint NOT NULL,
	"falta_after_minutes" smallint,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incidencia_rules_pkey" PRIMARY KEY("company_id","effective_period"),
	CONSTRAINT "incidencia_rules_period_check" CHECK ("effective_period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])-Q[12]$'),
	CONSTRAINT "incidencia_rules_minutes_check" CHECK ("retardo_tolerance_minutes" BETWEEN 0 AND 120 AND "salida_tolerance_minutes" BETWEEN 0 AND 120 AND ("falta_after_minutes" IS NULL OR "falta_after_minutes" BETWEEN "retardo_tolerance_minutes" + 1 AND 720))
);
--> statement-breakpoint
CREATE TABLE "incidencia_justifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_day" date NOT NULL,
	"to_day" date NOT NULL,
	"incidencia_kind" text,
	"effect" text NOT NULL,
	"reason" text NOT NULL,
	"reference" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	CONSTRAINT "incidencia_justifications_kind_check" CHECK ("kind" IN ('permiso_con_goce', 'permiso_sin_goce', 'incapacidad_imss', 'override')),
	CONSTRAINT "incidencia_justifications_dates_check" CHECK ("to_day" >= "from_day" AND "to_day" - "from_day" <= 366),
	CONSTRAINT "incidencia_justifications_override_check" CHECK (("kind" = 'override' AND "incidencia_kind" IN ('falta', 'retardo', 'salida_anticipada') AND "from_day" = "to_day") OR ("kind" <> 'override' AND "incidencia_kind" IS NULL AND "effect" = 'justify')),
	CONSTRAINT "incidencia_justifications_effect_check" CHECK ("effect" IN ('justify', 'void')),
	CONSTRAINT "incidencia_justifications_text_check" CHECK (char_length("reason") BETWEEN 1 AND 280 AND ("reference" IS NULL OR char_length("reference") <= 80) AND ("cancel_reason" IS NULL OR char_length("cancel_reason") <= 280)),
	CONSTRAINT "incidencia_justifications_cancel_check" CHECK (("cancelled_at" IS NULL) = ("cancel_reason" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "incidencia_rules" ADD CONSTRAINT "incidencia_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidencia_rules" ADD CONSTRAINT "incidencia_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidencia_justifications" ADD CONSTRAINT "incidencia_justifications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidencia_justifications" ADD CONSTRAINT "incidencia_justifications_company_person_fk" FOREIGN KEY ("company_id","person_id") REFERENCES "public"."people"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidencia_justifications" ADD CONSTRAINT "incidencia_justifications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidencia_justifications" ADD CONSTRAINT "incidencia_justifications_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "incidencia_justifications_company_person_from_idx" ON "incidencia_justifications" USING btree ("company_id","person_id","from_day");--> statement-breakpoint
ALTER TABLE "incidencia_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incidencia_justifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "incidencia_rules_company_isolation" ON "incidencia_rules" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "incidencia_justifications_company_isolation" ON "incidencia_justifications" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
-- Decisions are kept: the app cancels a justification (UPDATE of the cancel
-- columns), never deletes one. A rules row is replaced while its quincena has
-- not started (UPSERT), never deleted.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT SELECT, INSERT, UPDATE ON "incidencia_rules" TO workia_app;
		REVOKE DELETE ON "incidencia_rules" FROM workia_app;
		GRANT SELECT, INSERT, UPDATE ON "incidencia_justifications" TO workia_app;
		REVOKE DELETE ON "incidencia_justifications" FROM workia_app;
	END IF;
END $$;

-- Rollback (by hand; nothing else references these tables):
--   DROP TABLE "incidencia_justifications";
--   DROP TABLE "incidencia_rules";
--   DELETE FROM drizzle.applied_migrations WHERE tag = '0051_incidencias_engine';
