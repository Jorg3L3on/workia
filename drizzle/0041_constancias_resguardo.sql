-- Workia 2.0 W2-11: constancias and contract in the employee app.
-- 1) The access log names the seniority letter as its own resource, next to
--    contract_pdf, so a download of either is one row per read.
-- 2) An employee accepts a resguardo (the entrega of an asset) from the phone:
--    the entrega row records when and with which employee account. Only an
--    entrega can be accepted, once. No e-signature: this is an acceptance
--    click, kept with the audit trail.
ALTER TABLE "personal_data_access_log" DROP CONSTRAINT "personal_data_access_log_resource_check";--> statement-breakpoint
ALTER TABLE "personal_data_access_log" ADD CONSTRAINT "personal_data_access_log_resource_check" CHECK ("personal_data_access_log"."resource" IN ('contract_pdf', 'document_file', 'payroll_receipt', 'vacation_constancia', 'arco_export', 'seniority_letter'));--> statement-breakpoint
ALTER TABLE "asset_movements" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "asset_movements" ADD COLUMN "accepted_by_employee_account_id" uuid;--> statement-breakpoint
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_company_accepted_by_fk" FOREIGN KEY ("company_id","accepted_by_employee_account_id") REFERENCES "public"."employee_accounts"("company_id","id") ON DELETE SET NULL ("accepted_by_employee_account_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_acceptance_check" CHECK ("asset_movements"."accepted_at" IS NULL OR "asset_movements"."type" = 'entrega');--> statement-breakpoint
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_accepted_by_check" CHECK ("asset_movements"."accepted_by_employee_account_id" IS NULL OR "asset_movements"."accepted_at" IS NOT NULL);
