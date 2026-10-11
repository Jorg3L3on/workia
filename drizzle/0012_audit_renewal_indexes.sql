CREATE INDEX "audit_events_resource_occurred_idx" ON "audit_events" USING btree ("resource_type","resource_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "contracts_renewal_end_date_idx" ON "contracts" USING btree ("end_date") WHERE "contracts"."status" = 'vigente' AND "contracts"."type" = 'determinado' AND "contracts"."deleted_at" IS NULL;
