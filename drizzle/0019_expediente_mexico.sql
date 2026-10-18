-- WRK-I5-1: Expediente México. Structured address, civil data and INE on people,
-- and the beneficiaries of each person (percentages add up to 100, checked in the app).
-- Additive: every new column is nullable; nothing existing changes.
CREATE TYPE "public"."marital_status" AS ENUM('soltero', 'casado', 'union_libre', 'divorciado', 'viudo');--> statement-breakpoint
CREATE TYPE "public"."person_sex" AS ENUM('H', 'M');--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "domicilio_calle" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "domicilio_numero_exterior" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "domicilio_numero_interior" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "domicilio_colonia" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "domicilio_municipio" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "domicilio_estado" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "domicilio_codigo_postal" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "estado_civil" "marital_status";--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "sexo" "person_sex";--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "lugar_nacimiento" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "nacionalidad" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "ine_clave_elector" text;--> statement-breakpoint
CREATE TABLE "person_beneficiaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"nombre" text NOT NULL,
	"parentesco" text NOT NULL,
	"porcentaje" numeric(5, 2) NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_beneficiaries_porcentaje_check" CHECK ("porcentaje" > 0 AND "porcentaje" <= 100)
);--> statement-breakpoint
ALTER TABLE "person_beneficiaries" ADD CONSTRAINT "person_beneficiaries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_beneficiaries" ADD CONSTRAINT "person_beneficiaries_company_person_fk" FOREIGN KEY ("company_id","person_id") REFERENCES "public"."people"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "person_beneficiaries_company_person_idx" ON "person_beneficiaries" USING btree ("company_id","person_id");--> statement-breakpoint
ALTER TABLE "person_beneficiaries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "person_beneficiaries_company_isolation" ON "person_beneficiaries" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "person_beneficiaries" TO workia_app;
	END IF;
END $$;
