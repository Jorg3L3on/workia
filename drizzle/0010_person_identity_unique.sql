-- Normalize identifiers: uppercase, no whitespace, blank -> NULL.
UPDATE "people" SET "curp" = NULLIF(upper(regexp_replace("curp", '\s', '', 'g')), '') WHERE "curp" IS NOT NULL;--> statement-breakpoint
UPDATE "people" SET "rfc" = NULLIF(upper(regexp_replace("rfc", '\s', '', 'g')), '') WHERE "rfc" IS NOT NULL;--> statement-breakpoint
UPDATE "people" SET "nss" = NULLIF(regexp_replace("nss", '\s', '', 'g'), '') WHERE "nss" IS NOT NULL;--> statement-breakpoint
-- Fail with a readable message instead of an index error when duplicates remain.
-- Run `npm run db:report-identity-duplicates` to list and resolve them first.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "people" WHERE "deleted_at" IS NULL AND "curp" IS NOT NULL GROUP BY "curp" HAVING count(*) > 1)
		OR EXISTS (SELECT 1 FROM "people" WHERE "deleted_at" IS NULL AND "rfc" IS NOT NULL GROUP BY "rfc" HAVING count(*) > 1) THEN
		RAISE EXCEPTION 'people has active duplicates by curp or rfc; resolve them before migrating (npm run db:report-identity-duplicates)';
	END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "people_curp_active_unique" ON "people" USING btree ("curp") WHERE "people"."deleted_at" is null and "people"."curp" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "people_rfc_active_unique" ON "people" USING btree ("rfc") WHERE "people"."deleted_at" is null and "people"."rfc" is not null;
