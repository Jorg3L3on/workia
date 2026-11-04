-- Workia 2.0 W2-18. Pre-nómina: the file HR hands the payroll provider for a
-- closed quincena. Two changes:
--
-- 1. The close snapshot keeps why each justified incidencia was justified
--    (vacation, permiso con goce, permiso sin goce, IMSS incapacidad; the
--    rest are HR overrides) and the minutes of the justified ones, so the
--    file counts permisos, incapacidades and vacations from what was frozen,
--    never from live events. New columns default to 0: a snapshot taken
--    before this migration reads as justified by HR until the quincena is
--    reopened and closed again (the data so far is test data).
-- 2. prenomina_templates: per company, how the provider wants the file (CSV
--    or Excel, one row per person or one per person and concept, columns,
--    concept codes, delimiter, encoding, date format). The provider is not
--    chosen yet, so nothing here is specific to one. A template is archived,
--    never deleted.
ALTER TABLE "incidencias_period_snapshot" ADD COLUMN "justified_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "incidencias_period_snapshot" ADD COLUMN "justified_vacation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "incidencias_period_snapshot" ADD COLUMN "justified_permiso_con_goce" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "incidencias_period_snapshot" ADD COLUMN "justified_permiso_sin_goce" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "incidencias_period_snapshot" ADD COLUMN "justified_incapacidad" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "incidencias_period_snapshot" ADD CONSTRAINT "incidencias_period_snapshot_justified_check" CHECK ("justified_minutes" BETWEEN 0 AND "minutes" AND "justified_vacation" >= 0 AND "justified_permiso_con_goce" >= 0 AND "justified_permiso_sin_goce" >= 0 AND "justified_incapacidad" >= 0 AND "justified_vacation" + "justified_permiso_con_goce" + "justified_permiso_sin_goce" + "justified_incapacidad" <= "justified");--> statement-breakpoint
CREATE TABLE "prenomina_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"format" text NOT NULL,
	"layout" text NOT NULL,
	"delimiter" text DEFAULT ',' NOT NULL,
	"encoding" text DEFAULT 'utf8_bom' NOT NULL,
	"date_format" text DEFAULT 'iso' NOT NULL,
	"include_header" boolean DEFAULT true NOT NULL,
	"skip_empty" boolean DEFAULT true NOT NULL,
	"columns" jsonb NOT NULL,
	"concept_codes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "prenomina_templates_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "prenomina_templates_name_check" CHECK (char_length("name") BETWEEN 1 AND 80),
	CONSTRAINT "prenomina_templates_format_check" CHECK ("format" IN ('csv', 'xlsx')),
	CONSTRAINT "prenomina_templates_layout_check" CHECK ("layout" IN ('wide', 'long')),
	CONSTRAINT "prenomina_templates_delimiter_check" CHECK ("delimiter" IN (',', ';', '|', E'\t')),
	CONSTRAINT "prenomina_templates_encoding_check" CHECK ("encoding" IN ('utf8_bom', 'utf8', 'latin1')),
	CONSTRAINT "prenomina_templates_date_format_check" CHECK ("date_format" IN ('iso', 'dmy', 'dmy_dash', 'ymd_compact')),
	CONSTRAINT "prenomina_templates_columns_check" CHECK (jsonb_typeof("columns") = 'array' AND jsonb_array_length("columns") BETWEEN 1 AND 60 AND pg_column_size("columns") <= 16384),
	CONSTRAINT "prenomina_templates_concept_codes_check" CHECK (jsonb_typeof("concept_codes") = 'object' AND pg_column_size("concept_codes") <= 4096)
);
--> statement-breakpoint
ALTER TABLE "prenomina_templates" ADD CONSTRAINT "prenomina_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prenomina_templates" ADD CONSTRAINT "prenomina_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prenomina_templates_company_name_active_unique" ON "prenomina_templates" USING btree ("company_id",lower("name")) WHERE "archived_at" IS NULL;--> statement-breakpoint
ALTER TABLE "prenomina_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "prenomina_templates_company_isolation" ON "prenomina_templates" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
-- Templates are archived (UPDATE archived_at), never deleted.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT SELECT, INSERT, UPDATE ON "prenomina_templates" TO workia_app;
		REVOKE DELETE ON "prenomina_templates" FROM workia_app;
	END IF;
END $$;

-- Rollback (by hand; nothing else references the table):
--   DROP TABLE "prenomina_templates";
--   ALTER TABLE "incidencias_period_snapshot" DROP CONSTRAINT "incidencias_period_snapshot_justified_check",
--     DROP COLUMN "justified_minutes", DROP COLUMN "justified_vacation",
--     DROP COLUMN "justified_permiso_con_goce", DROP COLUMN "justified_permiso_sin_goce",
--     DROP COLUMN "justified_incapacidad";
--   DELETE FROM drizzle.applied_migrations WHERE tag = '0052_prenomina';
