-- WRK-I12-1: the data behind the turnover report (Reportes → Rotación).
--
-- 1. Each motivo de baja gets a classification (voluntaria / involuntaria / otra), so the
--    report splits turnover by who decided. NULL means «sin clasificar»: the report counts
--    it as «otra» and warns about it. The base list (TERMINATION_REASON_SEED) gets its
--    defaults by name; reasons a company created itself stay NULL until HR classifies them.
--    Two base reasons for the end of the 90-day trial are added to every company that
--    already has its list (a company without one gets the whole list on first use).
-- 2. A closed employment period keeps the área, sucursal, puesto and jefe the person had
--    when it closed, so a later move does not rewrite history. Filled by the domain when a
--    period closes and, for periods closed before this migration, by
--    scripts/backfill-turnover-dimensions.ts.
-- 3. The company's monthly turnover goal (%), with no default: no goal, no goal line.
-- 4. Saved views get a kind, so the report keeps its own next to the Personas list's.
CREATE TYPE "public"."termination_classification" AS ENUM('voluntaria', 'involuntaria', 'otra');--> statement-breakpoint
ALTER TABLE "termination_reasons" ADD COLUMN "classification" "termination_classification";--> statement-breakpoint
-- data-loss-ok: fills the column added above (all NULL) for the base reasons only; nothing is overwritten.
UPDATE "termination_reasons" AS "reason"
SET "classification" = "seed"."classification"::"termination_classification"
FROM (VALUES
	('Renuncia voluntaria', 'voluntaria'),
	('Mejor oferta laboral', 'voluntaria'),
	('Motivos personales o familiares', 'voluntaria'),
	('Cambio de residencia', 'voluntaria'),
	('Abandono de empleo', 'voluntaria'),
	('Faltas injustificadas', 'involuntaria'),
	('Bajo desempeño', 'involuntaria'),
	('Incumplimiento de políticas', 'involuntaria'),
	('Reestructura o recorte de personal', 'involuntaria'),
	('Fin de contrato o proyecto', 'involuntaria'),
	('Jubilación', 'otra'),
	('Fallecimiento', 'otra'),
	('Otro', 'otra')
) AS "seed"("name", "classification")
WHERE catalog_key("reason"."name") = catalog_key("seed"."name")
	AND "reason"."classification" IS NULL;--> statement-breakpoint
INSERT INTO "termination_reasons" ("company_id", "name", "classification")
SELECT DISTINCT "existing"."company_id", "seed"."name", "seed"."classification"::"termination_classification"
FROM "termination_reasons" AS "existing"
CROSS JOIN (VALUES
	('No aprobó el periodo de prueba', 'involuntaria'),
	('No aceptó renovar contrato', 'voluntaria')
) AS "seed"("name", "classification")
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "employment_periods" ADD COLUMN "area_id" uuid;--> statement-breakpoint
ALTER TABLE "employment_periods" ADD COLUMN "site_id" uuid;--> statement-breakpoint
ALTER TABLE "employment_periods" ADD COLUMN "position_id" uuid;--> statement-breakpoint
ALTER TABLE "employment_periods" ADD COLUMN "manager_id" uuid;--> statement-breakpoint
-- Simple FKs clear the value when the row is hard-deleted; the composite ones keep a
-- period from pointing at another company's row (as on people, decision b2abb57c).
ALTER TABLE "employment_periods" ADD CONSTRAINT "employment_periods_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_periods" ADD CONSTRAINT "employment_periods_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_periods" ADD CONSTRAINT "employment_periods_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_periods" ADD CONSTRAINT "employment_periods_manager_id_people_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_periods" ADD CONSTRAINT "employment_periods_company_area_fk" FOREIGN KEY ("company_id","area_id") REFERENCES "public"."areas"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_periods" ADD CONSTRAINT "employment_periods_company_site_fk" FOREIGN KEY ("company_id","site_id") REFERENCES "public"."sites"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_periods" ADD CONSTRAINT "employment_periods_company_position_fk" FOREIGN KEY ("company_id","position_id") REFERENCES "public"."positions"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_periods" ADD CONSTRAINT "employment_periods_company_manager_fk" FOREIGN KEY ("company_id","manager_id") REFERENCES "public"."people"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Ingresos per month and the cohorts start from the hire date; bajas already have
-- employment_periods_company_fecha_baja_idx. No index per área or jefe until the report
-- needs one (decision b36e7e24).
CREATE INDEX "employment_periods_company_fecha_ingreso_idx" ON "employment_periods" USING btree ("company_id","fecha_ingreso");--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "turnover_goal_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_turnover_goal_pct_check" CHECK ("turnover_goal_pct" IS NULL OR ("turnover_goal_pct" > 0 AND "turnover_goal_pct" <= 100));--> statement-breakpoint
ALTER TABLE "people_views" ADD COLUMN "kind" text DEFAULT 'people' NOT NULL;--> statement-breakpoint
ALTER TABLE "people_views" ADD CONSTRAINT "people_views_kind_check" CHECK ("kind" IN ('people', 'turnover'));

-- Rollback (by hand, in this order; the two added reasons can only go while no baja uses them):
--   ALTER TABLE "people_views" DROP CONSTRAINT "people_views_kind_check";
--   ALTER TABLE "people_views" DROP COLUMN "kind";  -- turnover views would then show as Personas views: delete them first
--   ALTER TABLE "companies" DROP CONSTRAINT "companies_turnover_goal_pct_check";
--   ALTER TABLE "companies" DROP COLUMN "turnover_goal_pct";
--   DROP INDEX IF EXISTS "employment_periods_company_fecha_ingreso_idx";
--   ALTER TABLE "employment_periods" DROP COLUMN "area_id", DROP COLUMN "site_id", DROP COLUMN "position_id", DROP COLUMN "manager_id";
--   ALTER TABLE "termination_reasons" DROP COLUMN "classification";
--   DROP TYPE "termination_classification";
--   DELETE FROM drizzle.applied_migrations WHERE tag = '0027_turnover_report';
