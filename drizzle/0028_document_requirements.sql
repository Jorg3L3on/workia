-- WRK-I15-1. Documentos por puesto: el catálogo de requisitos de una empresa
-- (puesto opcional = todos los puestos) y la fecha en que una persona entregó
-- cada uno. Sin archivos, sin número de documento y sin texto libre: una nota
-- podría guardar datos de salud, así que person_documents no tiene columna
-- note (desvío intencional del ticket, que la listaba). Un examen médico, si
-- RH lo agrega como requisito, es solo delivered_on: no hay resultado ni
-- observaciones.
--
-- La semilla de los 7 documentos del alta no vive aquí. La copia
-- activateDocumentRequirements cuando la empresa activa el módulo, y la
-- constancia fiscal y la cuenta bancaria quedan required = false.
CREATE TABLE "document_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"position_id" uuid,
	"name" text NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"validity_months" integer,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_requirements_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "document_requirements_validity_months_check" CHECK ("validity_months" IS NULL OR "validity_months" > 0)
);--> statement-breakpoint
ALTER TABLE "document_requirements" ADD CONSTRAINT "document_requirements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requirements" ADD CONSTRAINT "document_requirements_company_position_fk" FOREIGN KEY ("company_id","position_id") REFERENCES "public"."positions"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_requirements_position_name_active_unique" ON "document_requirements" USING btree ("company_id","position_id",catalog_key("name")) WHERE "document_requirements"."deleted_at" is null AND "document_requirements"."position_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "document_requirements_company_name_active_unique" ON "document_requirements" USING btree ("company_id",catalog_key("name")) WHERE "document_requirements"."deleted_at" is null AND "document_requirements"."position_id" is null;--> statement-breakpoint
ALTER TABLE "document_requirements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "document_requirements_company_isolation" ON "document_requirements" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "document_requirements" TO workia_app;
	END IF;
END $$;--> statement-breakpoint
CREATE TABLE "person_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"delivered_on" date NOT NULL,
	"expires_on" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_documents_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "person_documents_dates_check" CHECK ("expires_on" IS NULL OR "expires_on" >= "delivered_on")
);--> statement-breakpoint
ALTER TABLE "person_documents" ADD CONSTRAINT "person_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_documents" ADD CONSTRAINT "person_documents_company_person_fk" FOREIGN KEY ("company_id","person_id") REFERENCES "public"."people"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_documents" ADD CONSTRAINT "person_documents_company_requirement_fk" FOREIGN KEY ("company_id","requirement_id") REFERENCES "public"."document_requirements"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_documents" ADD CONSTRAINT "person_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "person_documents_company_person_idx" ON "person_documents" USING btree ("company_id","person_id");--> statement-breakpoint
CREATE INDEX "person_documents_company_expires_on_idx" ON "person_documents" USING btree ("company_id","expires_on");--> statement-breakpoint
ALTER TABLE "person_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "person_documents_company_isolation" ON "person_documents" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "person_documents" TO workia_app;
	END IF;
END $$;

-- Rollback (by hand, in this order; nothing else references these tables):
--   DROP TABLE "person_documents";
--   DROP TABLE "document_requirements";
--   DELETE FROM drizzle.applied_migrations WHERE tag = '0028_document_requirements';
