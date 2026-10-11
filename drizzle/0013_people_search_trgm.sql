CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "people_search_trgm_idx" ON "people" USING gin (("nombres" || ' ' || "apellido_paterno" || ' ' || coalesce("apellido_materno", '') || ' ' || coalesce("rfc", '') || ' ' || coalesce("curp", '') || ' ' || coalesce("email", '')) gin_trgm_ops);
