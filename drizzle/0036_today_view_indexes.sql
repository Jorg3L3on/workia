-- Workia 2.0 P-04. The today view reads the roster of a site, an area or a
-- manager's team from people and, per person, probes the indexes person_events
-- already has: person_events_dedupe_unique for the day's attendance row
-- ('attendance:<day>') and person_events_person_time_idx for the day's
-- incidencias (docs/keyset.md). It starts from people, so absent people are in
-- it, and it needs no index of its own.
-- person_events_site_day_idx (0031) was the punch-driven version of that view:
-- keyed by payload->>'site_id', it could not list who did not punch, and it
-- grows with every attendance row, the bulk of the table, on the 1 GB Neon Free
-- plan. Nothing reads it, so it is dropped. Dropping an index loses no data.
DROP INDEX IF EXISTS "person_events_site_day_idx";

-- Rollback (by hand):
--   CREATE INDEX "person_events_site_day_idx" ON "person_events" USING btree ("company_id",("payload" ->> 'site_id'),"occurred_at") WHERE "type" in ('attendance', 'incidencia');
--   DELETE FROM drizzle.applied_migrations WHERE tag = '0036_today_view_indexes';
