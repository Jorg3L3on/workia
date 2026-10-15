# Migrations

SQL migrations live in `drizzle/` and run in the order of
`drizzle/meta/_journal.json`. Plania: WRK-I4-2.

## The registry

`npm run db:migrate` records every migration it applies in
`drizzle.applied_migrations` (one row per tag, with the file's SHA-256 and
whether it was `applied` or `baseline`). It:

- applies only the migrations whose tag is not in the registry, in journal
  order, each in its own transaction together with its registry row, so a
  failure rolls back that migration and leaves it pending;
- applies nothing on a second run;
- refuses to run when an applied migration's file was edited afterwards
  (write a new migration instead) or when a `.sql` file is missing from the
  journal (it would never run);
- holds a Postgres advisory lock, so two runs never interleave.

The registry is keyed by tag rather than by timestamp. Drizzle's own migrator
only compares against the newest applied timestamp, so a migration merged from
a parallel branch with an older timestamp would be skipped without notice.

```bash
npm run db:migrate                     # apply pending migrations
npm run db:migrate -- --status         # list applied and pending, change nothing
npm run db:migrate -- --baseline 0014  # record 0000..0014 (journal order) as applied, run nothing
```

`DATABASE_URL` decides the target. When it is not on this machine, every
command also needs `--confirm-host <hostname>`, so production is never touched
by accident.

## Writing a migration

1. Reserve the number in Plania (`reserve_sequence` with `name: "migration"`),
   then `npm run db:generate` (or write the SQL by hand) and rename the file to
   that number. Numbers can have gaps (0009 is held by WRK-I1).
2. Prefer additive changes. A statement that can lose or rewrite data
   (`DROP TABLE`, `DROP COLUMN`, `DROP SCHEMA`, `TRUNCATE`, `DELETE FROM`,
   `UPDATE ... SET`, `ALTER COLUMN ... TYPE`) needs a line in the same file:

   ```sql
   -- data-loss-ok: <why it is safe, e.g. column unused since WRK-12 and backed up>
   ```

   `npm run check:migrations` (run by CI on every pull request) fails on any
   added or changed migration with such a statement and no approval line.
   Migrations that already shipped are not re-judged.

3. Never edit a migration after it ran anywhere shared; add a new one.
4. CI applies every migration to an empty Postgres twice; the second run must
   apply nothing.

Set up local databases with `npm run db:migrate` too. `db:push` cannot create
everything the migrations do (for example the `catalog_key()` function behind
the per-company catalog indexes), and a pushed database has no registry.

## Production

Only Jorge applies migrations to production.

### Once: adopt the registry

Production ran 0000 to 0014 by hand before the registry existed.

1. Confirm the schema really has 0014 (WRK-I4-1: `import_rows.undone_at`,
   `people_curp_active_unique`, `people_rfc_active_unique`,
   `people_search_trgm_idx`).
2. Check the plan. Everything should show as pending:

   ```bash
   DATABASE_URL=<prod> npm run db:migrate -- --status --confirm-host <prod-host>
   ```

3. Record 0000 to 0014 as applied without running them:

   ```bash
   DATABASE_URL=<prod> npm run db:migrate -- --baseline 0014 --confirm-host <prod-host>
   ```

4. Run `--status` again. Every migration should show as `baseline` and none as
   pending.

### The multi-company cutover (0015–0018)

Follow [multiempresa.md](multiempresa.md) → «Corte a producción»: duplicate
report, counts snapshot, migrate, `npm run db:cutover -- verify`, deploy.

### Every release with migrations

1. Take a Neon restore point (branch from the current state) before applying.
2. `--status` to see what is pending, and compare it with the release.
3. `DATABASE_URL=<prod> npm run db:migrate -- --confirm-host <prod-host>`.
4. Deploy the code (merge `sandbox` → `main`). Migrations go first, so they
   must stay compatible with the code that is still running (expand, then
   contract in a later release).
5. To roll back, restore the Neon branch from step 1; the registry is rolled
   back with it.
