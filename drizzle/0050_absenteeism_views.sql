-- Workia 2.0 W2-20. Saved views of the absenteeism and turnover report by
-- region and sucursal (/app/reportes/ausentismo) live in people_views next to
-- the Personas and turnover ones, with kind 'absenteeism'. The check only
-- gains a value: every existing row still passes, and no data changes.
ALTER TABLE "people_views" DROP CONSTRAINT "people_views_kind_check";--> statement-breakpoint
ALTER TABLE "people_views" ADD CONSTRAINT "people_views_kind_check" CHECK ("kind" IN ('people', 'turnover', 'absenteeism'));

-- Rollback (by hand):
--   DELETE FROM "people_views" WHERE "kind" = 'absenteeism';
--   ALTER TABLE "people_views" DROP CONSTRAINT "people_views_kind_check";
--   ALTER TABLE "people_views" ADD CONSTRAINT "people_views_kind_check" CHECK ("kind" IN ('people', 'turnover'));
--   DELETE FROM drizzle.applied_migrations WHERE tag = '0050_absenteeism_views';
