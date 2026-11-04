# Neon Free budget, restore drill and monitoring

Workia 2.0, task P-03. Workia runs on Neon's Free plan, and its limits are
design inputs. This page says what the app watches, how to run the load test
and the restore drill, and what the measurements so far show.

Neon and Vercel settings are Jorge's. Nothing here changes a plan, a compute
setting, a branch or an environment variable: the scripts only read, or write
inside a schema of their own on a branch made for the test.

## The limits

| Limit           | Free plan                                     | What happens when it runs out              |
| --------------- | --------------------------------------------- | ------------------------------------------ |
| Storage         | 1 GB per project (logical size, every branch) | Writes that grow storage fail              |
| Compute         | 100 CU-hours per project per month            | Compute is suspended until the next period |
| Egress          | 5 GB per month                                | Compute is suspended until the next period |
| Branches        | 10 per project                                | No new branches                            |
| Restore history | 6 hours                                       | Older points cannot be restored            |

The numbers live in `src/lib/db-usage/limits.ts` (`NEON_FREE_LIMITS`). Neon
counts in decimal units (1 GB = 10^9 bytes), and so does the app.

### What the compute limit means in hours

Compute is counted while the compute is awake, times its size. It scales to
zero after 5 minutes without queries, and the smallest size is 0.25 CU. So
100 CU-hours is 400 awake hours a month at 0.25 CU, about 13 hours a day over
31 days, and half that if it autoscales to 0.5 CU. What spends the budget is
how long the database stays awake, not how many queries run while it is. That
is why ingestion runs in batched windows and the app caches readings it does
not need fresh (the usage reading below is reused for 10 minutes).

## What the app shows

- **HR admins** (anyone with `settings:update` in the company) see a warning
  on the home page when any limit passes 80 %, and an urgent one from 95 %.
  Below 80 % nothing is shown.
- **Platform admins** have `/admin/uso`: every limit as a meter, the largest
  tables, and the slowest statements from `pg_stat_statements`.

Without configuration the app reads the database size from Postgres
(`pg_database_size`). Compute, egress, branch count and the storage Neon
counts (the logical size of every branch) need the Neon API:

| Variable          | What                                              |
| ----------------- | ------------------------------------------------- |
| `NEON_API_KEY`    | A Neon API key. A project-scoped key is enough.   |
| `NEON_PROJECT_ID` | The project id, from the project settings in Neon |

Both are optional, and adding them is Jorge's call. The endpoints the app
calls (`GET /projects/{id}` and `GET /projects/{id}/branches`) do not wake a
suspended compute, so reading them costs no compute. Neon marks these
numbers as monitoring figures, not billing.

## Slow-query report

Migration 0034 creates the `pg_stat_statements` extension (Neon already loads
the library). The report is on `/admin/uso` and in the terminal:

```bash
npm run db:report-slow-queries                # by total time
npm run db:report-slow-queries -- --mean      # by mean time
npm run db:report-slow-queries -- --limit 20
```

On Neon the statistics reset whenever the compute scales to zero, so read
them while the app is in use or right after the load test. Query text is
normalized (`$1`, `$2`) and holds no values.

## Load test

`npm run db:load-test` builds a table shaped like the planned
`person_events` (P-01) in its own `load_test` schema, with the same
row-level security policy as the business tables, loads a year of attendance
(one row per person per day), then simulates a day:

- two ingestion windows (entrada, salida), one batched upsert per site;
- every employee reading their last 31 days at the same time;
- each site's manager opening the today view.

It prints p50, p95 and max latency per operation, bytes per attendance row,
storage written per day and, with `NEON_API_KEY` and `NEON_PROJECT_ID` set,
the CU-hours and awake minutes the run used. It drops the schema at the end
(`--keep` leaves it).

```bash
npm run db:load-test                           # local Postgres
npm run db:load-test -- --employees 500 --sites 10 --history-days 365 --days 1 --pool 10
```

### On a Neon branch

The run belongs on a branch made for it, never on the production branch:

1. In the Neon console, create a branch from `main` (it counts toward the 10).
2. Copy its connection string (the pooled one).
3. Run, with row-level security on as in production:

   ```bash
   LOAD_TEST_REMOTE_HOST=<branch host> DATABASE_URL=<branch url> DATABASE_RLS=1 \
     NEON_API_KEY=<key> NEON_PROJECT_ID=<project> npm run db:load-test
   ```

   The script refuses a remote host unless `LOAD_TEST_REMOTE_HOST` names it.

4. Run `npm run db:report-slow-queries` against the branch right after.
5. Add the printed table to the results below, then delete the branch.

### Results

Local Postgres 16 in a cloud container, 2026-11-04, RLS on, 500 employees,
4 companies, 10 sites, 365 days of history, pool of 10:

| Measure                                                | Value                    |
| ------------------------------------------------------ | ------------------------ |
| Employee timeline read (31 days), p50 / p95 / max      | 1.5 ms / 3.3 ms / 5.0 ms |
| Manager today view, p50 / p95 / max                    | 1.5 ms / 1.8 ms / 1.8 ms |
| Site ingestion batch, p50 / p95 / max                  | 6.7 ms / 8.2 ms / 8.4 ms |
| A year of attendance for 500 people                    | 182,500 rows, 107.6 MB   |
| Bytes per attendance row (table and its three indexes) | 590 B                    |
| Storage written per day                                | 352 kB                   |

The local run measures query cost and storage, not Neon's network or compute.
The Neon branch run is still to do. What the storage numbers already say: a
year of attendance for 500 people is about a tenth of the 1 GB limit, so
retention (P-01) and keeping files out of the database matter more than
partitioning.

## Restore drill

Free keeps 6 hours of restore history and there are no other backups for now
(Jorge's decision). The drill proves a point-in-time restore works and how
long it takes, without touching `main`: it restores into a new branch.

1. Write down the time (T0) and pick a restore point a few minutes back.
2. In the Neon console, create a new branch with `main` as parent, from that
   past point in time. Do not restore `main` itself: that overwrites it.
3. Note when the branch is ready (T1) and copy its connection string.
4. Compare it with production. The script only runs SELECTs on both:

   ```bash
   DATABASE_URL=<production url> RESTORED_DATABASE_URL=<branch url> \
     npm run db:restore-drill
   ```

   It fails when the branch misses a migration or a table, or has an empty
   table the source has rows in. Rows written after the restore point show as
   differences.

5. Note when the check passed (T2), add a row below, then delete the branch.

| Date | Restore point | Branch ready (T1 − T0) | Cold start | Check | Result | By  |
| ---- | ------------- | ---------------------- | ---------- | ----- | ------ | --- |
|      |               |                        |            |       |        |     |

The check itself was tried on a local copy (`pg_dump` into a second
database): 40 tables and 31 migrations matched.
