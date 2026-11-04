-- Workia 2.0 W2-04. Archivos de documentos y revisión de RH. Revierte a
-- propósito la regla de 0028 («solo nombres, sin archivos»): un empleado sube
-- desde el teléfono el archivo de un requisito, RH lo acepta o lo rechaza, y
-- solo una entrega aceptada cuenta para el expediente, con las mismas reglas
-- de hoy (la más reciente por requisito, vigencia desde validity_months).
--
-- El archivo nunca va en Neon: file_key apunta al almacenamiento de objetos
-- (src/lib/storage). Sigue sin haber texto libre: el motivo de rechazo es un
-- código de una lista cerrada, así que no puede guardar datos de salud.
-- Un rechazo borra el archivo y deja la fila con su motivo.
--
-- Las filas que ya existen son entregas que RH registró a mano: quedan
-- status = 'accepted' y sin archivo, así que nada de lo que ya se muestra cambia.
ALTER TABLE "person_documents" ADD COLUMN "status" text DEFAULT 'accepted' NOT NULL;--> statement-breakpoint
ALTER TABLE "person_documents" ADD COLUMN "file_key" text;--> statement-breakpoint
ALTER TABLE "person_documents" ADD COLUMN "file_content_type" text;--> statement-breakpoint
ALTER TABLE "person_documents" ADD COLUMN "file_size" integer;--> statement-breakpoint
ALTER TABLE "person_documents" ADD COLUMN "uploaded_by_account_id" uuid;--> statement-breakpoint
ALTER TABLE "person_documents" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "person_documents" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "person_documents" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "person_documents" ADD CONSTRAINT "person_documents_status_check" CHECK ("status" IN ('uploaded', 'accepted', 'rejected'));--> statement-breakpoint
ALTER TABLE "person_documents" ADD CONSTRAINT "person_documents_file_check" CHECK (("file_key" IS NULL) = ("file_content_type" IS NULL) AND ("file_key" IS NULL) = ("file_size" IS NULL) AND ("file_size" IS NULL OR "file_size" > 0) AND ("status" <> 'uploaded' OR "file_key" IS NOT NULL) AND ("status" <> 'rejected' OR "file_key" IS NULL));--> statement-breakpoint
ALTER TABLE "person_documents" ADD CONSTRAINT "person_documents_rejection_check" CHECK (("status" = 'rejected') = ("rejection_reason" IS NOT NULL) AND ("rejection_reason" IS NULL OR "rejection_reason" IN ('illegible', 'wrong_document', 'expired', 'incomplete', 'wrong_person')));--> statement-breakpoint
ALTER TABLE "person_documents" ADD CONSTRAINT "person_documents_review_check" CHECK (("status" <> 'uploaded' OR "reviewed_at" IS NULL) AND ("status" <> 'rejected' OR "reviewed_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "person_documents" ADD CONSTRAINT "person_documents_company_uploaded_by_fk" FOREIGN KEY ("company_id","uploaded_by_account_id") REFERENCES "public"."employee_accounts"("company_id","id") ON DELETE SET NULL ("uploaded_by_account_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_documents" ADD CONSTRAINT "person_documents_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "person_documents_review_queue_idx" ON "person_documents" USING btree ("company_id","created_at","id") WHERE "person_documents"."status" = 'uploaded';--> statement-breakpoint
CREATE UNIQUE INDEX "person_documents_one_pending_unique" ON "person_documents" USING btree ("company_id","person_id","requirement_id") WHERE "person_documents"."status" = 'uploaded';

-- Rollback (by hand; delete the stored files first, then):
--   DROP INDEX "person_documents_one_pending_unique";
--   DROP INDEX "person_documents_review_queue_idx";
--   DELETE FROM "person_documents" WHERE "status" <> 'accepted';
--   ALTER TABLE "person_documents" DROP COLUMN "rejection_reason", DROP COLUMN "reviewed_at",
--     DROP COLUMN "reviewed_by", DROP COLUMN "uploaded_by_account_id", DROP COLUMN "file_size",
--     DROP COLUMN "file_content_type", DROP COLUMN "file_key", DROP COLUMN "status";
--   DELETE FROM drizzle.applied_migrations WHERE tag = '0043_document_files';
