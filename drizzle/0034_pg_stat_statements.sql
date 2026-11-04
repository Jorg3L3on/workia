-- Workia 2.0 P-03. Query statistics for the slow-query report (/admin/uso and
-- npm run db:report-slow-queries). Neon preloads the library; the extension
-- only adds the view. No table, no data. On Neon the statistics reset when
-- the compute scales to zero.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
