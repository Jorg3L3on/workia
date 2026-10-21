-- Iniciativa 2: baja y periodos laborales. A company's catalog of termination reasons
-- (seeded with a base list each company edits) and one row per employment period of a
-- person: ingreso, the seniority choice on a rehire and, once closed, the baja (fecha,
-- tipo, motivo, comentario, recontratable) and its finiquito. people.status and
-- people.fecha_ingreso stay as values derived from the current period, kept in sync by
-- the domain in the same transaction. At most one open period per person.
--
-- A period is open while it has no fecha_baja and is not a baja "sin fecha" (a baja
-- recorded before this migration whose date could not be inferred by the backfill,
-- scripts/backfill-employment-periods.ts, kept for manual review).
--
-- Contracts get the status 'terminado' (the vigente contract when the person is given
-- de baja). Onboardings go from one per person forever to one per employment period,
-- so a rehired person can get a new alta; and at most one in progress per person.
CREATE TYPE "public"."termination_type" AS ENUM('voluntaria', 'despido', 'termino_contrato', 'otra');--> statement-breakpoint
CREATE TYPE "public"."finiquito_status" AS ENUM('pendiente', 'pagado', 'no_aplica');--> statement-breakpoint
ALTER TYPE "public"."contract_status" ADD VALUE IF NOT EXISTS 'terminado';--> statement-breakpoint
CREATE TABLE "termination_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "termination_reasons_company_id_id_unique" UNIQUE("company_id","id")
);--> statement-breakpoint
ALTER TABLE "termination_reasons" ADD CONSTRAINT "termination_reasons_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "termination_reasons_company_name_active_unique" ON "termination_reasons" USING btree ("company_id",catalog_key("name")) WHERE "termination_reasons"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "termination_reasons_deleted_at_idx" ON "termination_reasons" USING btree ("deleted_at");--> statement-breakpoint
ALTER TABLE "termination_reasons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "termination_reasons_company_isolation" ON "termination_reasons" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "termination_reasons" TO workia_app;
	END IF;
END $$;--> statement-breakpoint
-- The base list (TERMINATION_REASON_SEED in src/lib/termination-reasons/schema.ts) for
-- every existing company; companies created later get it on first use.
INSERT INTO "termination_reasons" ("company_id", "name")
SELECT "companies"."id", "seed"."name"
FROM "companies"
CROSS JOIN (VALUES
	('Renuncia voluntaria'),
	('Mejor oferta laboral'),
	('Motivos personales o familiares'),
	('Cambio de residencia'),
	('Abandono de empleo'),
	('Faltas injustificadas'),
	('Bajo desempeño'),
	('Incumplimiento de políticas'),
	('Reestructura o recorte de personal'),
	('Fin de contrato o proyecto'),
	('Jubilación'),
	('Fallecimiento'),
	('Otro')
) AS "seed"("name")
ON CONFLICT DO NOTHING;--> statement-breakpoint
CREATE TABLE "employment_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"fecha_ingreso" date,
	"reconoce_antiguedad" boolean DEFAULT false NOT NULL,
	"fecha_antiguedad_reconocida" date,
	"fecha_antiguedad" date,
	"fecha_baja" date,
	"baja_sin_fecha" boolean DEFAULT false NOT NULL,
	"tipo_baja" "termination_type",
	"motivo_baja_id" uuid,
	"comentario_baja" text,
	"recontratable" boolean,
	"finiquito_estado" "finiquito_status",
	"finiquito_fecha" date,
	"finiquito_monto" numeric(12, 2),
	"fecha_baja_inferida" boolean DEFAULT false NOT NULL,
	"requiere_revision" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employment_periods_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "employment_periods_dates_check" CHECK ("fecha_baja" IS NULL OR "fecha_ingreso" IS NULL OR "fecha_baja" >= "fecha_ingreso"),
	CONSTRAINT "employment_periods_sin_fecha_check" CHECK (NOT "baja_sin_fecha" OR "fecha_baja" IS NULL),
	CONSTRAINT "employment_periods_finiquito_monto_check" CHECK ("finiquito_monto" IS NULL OR "finiquito_monto" >= 0)
);--> statement-breakpoint
ALTER TABLE "employment_periods" ADD CONSTRAINT "employment_periods_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_periods" ADD CONSTRAINT "employment_periods_company_person_fk" FOREIGN KEY ("company_id","person_id") REFERENCES "public"."people"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_periods" ADD CONSTRAINT "employment_periods_company_reason_fk" FOREIGN KEY ("company_id","motivo_baja_id") REFERENCES "public"."termination_reasons"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_periods" ADD CONSTRAINT "employment_periods_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employment_periods_one_open_per_person" ON "employment_periods" USING btree ("company_id","person_id") WHERE "employment_periods"."fecha_baja" is null and not "employment_periods"."baja_sin_fecha";--> statement-breakpoint
CREATE INDEX "employment_periods_company_fecha_baja_idx" ON "employment_periods" USING btree ("company_id","fecha_baja");--> statement-breakpoint
CREATE INDEX "employment_periods_person_id_idx" ON "employment_periods" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "employment_periods_motivo_baja_id_idx" ON "employment_periods" USING btree ("motivo_baja_id");--> statement-breakpoint
ALTER TABLE "employment_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "employment_periods_company_isolation" ON "employment_periods" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "employment_periods" TO workia_app;
	END IF;
END $$;--> statement-breakpoint
-- Onboardings: one per employment period instead of one per person. Rows created
-- before this migration have no period until the backfill (or the first period the app
-- opens for that person) links them.
ALTER TABLE "onboardings" ADD COLUMN "employment_period_id" uuid;--> statement-breakpoint
ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_company_period_fk" FOREIGN KEY ("company_id","employment_period_id") REFERENCES "public"."employment_periods"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboardings" DROP CONSTRAINT "onboardings_company_person_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "onboardings_company_period_unique" ON "onboardings" USING btree ("company_id","employment_period_id") WHERE "onboardings"."employment_period_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "onboardings_company_person_in_progress_unique" ON "onboardings" USING btree ("company_id","person_id") WHERE "onboardings"."stage" in ('rh_captura', 'pendiente_nominas');--> statement-breakpoint
CREATE INDEX "onboardings_company_person_idx" ON "onboardings" USING btree ("company_id","person_id");

-- Rollback (by hand, in this order; only before any contract is 'terminado' and any
-- person has more than one onboarding):
--   DROP INDEX "onboardings_company_person_idx";
--   DROP INDEX "onboardings_company_person_in_progress_unique";
--   DROP INDEX "onboardings_company_period_unique";
--   ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_company_person_unique" UNIQUE("company_id","person_id");
--   ALTER TABLE "onboardings" DROP CONSTRAINT "onboardings_company_period_fk";
--   ALTER TABLE "onboardings" DROP COLUMN "employment_period_id";
--   DROP TABLE "employment_periods";
--   DROP TABLE "termination_reasons";
--   DROP TYPE "finiquito_status";
--   DROP TYPE "termination_type";
--   -- Postgres cannot drop an enum value: first move terminado contracts back
--   -- (UPDATE contracts SET status = 'vencido' WHERE status = 'terminado'), then
--   -- recreate contract_status without 'terminado' and ALTER COLUMN status TYPE to it.
--   DELETE FROM drizzle.applied_migrations WHERE tag = '0025_employment_periods';
