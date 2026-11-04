# Person timeline

What happened to a person, in one table. Workia 2.0 task P-01, built on the
[identity model](identity-model.md). Migration `0031_person_events`, schema
`src/lib/db/schema/timeline.ts`, helpers `src/lib/timeline`.

## The table

`person_events` is append-only. Every event about a person goes there, in the
same transaction as the change that caused it.

| Column        | What                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------- |
| `id`          | uuid, primary key                                                                                   |
| `company_id`  | the person's company; RLS compares it with `app.company_id`                                         |
| `person_id`   | composite foreign key `(company_id, person_id)` → `people`, `ON DELETE CASCADE`                     |
| `type`        | `person_event_type`: `attendance`, `incidencia`, `vacation`, `receipt`, `document`, `employment`    |
| `occurred_at` | when it happened (timestamptz)                                                                      |
| `source`      | what produced it: `app`, `checador:<device>`, `payroll`, `import`… (1 to 64 characters)             |
| `dedupe_key`  | idempotency key, unique per person; required on attendance                                          |
| `payload`     | a JSON object, at most 4 KB: punches, the incidencia kind, the receipt period, the document status… |

There is no CURP column and no account id: a person is `(company_id,
person_id)`. Who did something stays in `audit_events` (actor, action,
result). An action that is both, such as HR accepting a document, writes one
row in each table, in the same transaction.

### Rules the database enforces

- **One attendance row per person per day.** An attendance row must have a
  `dedupe_key` of the form `attendance:YYYY-MM-DD` (the local date of the
  site), and `(person_id, dedupe_key)` is unique. The punches of the day go in
  the payload.
- **Idempotent ingestion.** Any other type may carry a key built from its id in
  the source system (`sourceDedupeKey`, for example `receipt:payroll:<uuid>`).
  `appendPersonEvents` skips keys already stored, so an ingestion can be re-run.
- **Append-only for the app.** The `workia_app` role has `SELECT`, `INSERT` and
  `DELETE` on the table, not `UPDATE`. A correction is a new event.
- **Company isolation.** RLS policy `person_events_company_isolation`, like
  every business table, and the composite foreign key refuses an event that
  points at a person of another company. Company RLS does not separate one
  employee from another: the employee guard and IDOR tests do that (W2-01).

### Indexes

| Index                           | On                                                                                      | For                                           |
| ------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------- |
| `person_events_person_time_idx` | `(company_id, person_id, occurred_at DESC, id DESC)`                                    | one person's history, keyset pages, retention |
| `person_events_site_day_idx`    | `(company_id, payload->>'site_id', occurred_at)` where type is attendance or incidencia | the today view of one site                    |
| `person_events_dedupe_unique`   | unique `(person_id, dedupe_key)` where the key is not null                              | idempotent ingestion                          |

The dedupe index leaves out `company_id` because person ids are already unique
across companies, and attendance keys hold only the date. Attendance is most of
the rows, so those bytes matter on the Neon Free plan (below).

No partitions, no triggers, no counters and no extension. Partitioning is
reconsidered only if P-03's measurements on Neon call for it.

## Reading and writing

```ts
import {
  appendPersonEvents,
  attendanceDedupeKey,
  listPersonEvents,
} from "@/lib/timeline";

// Inside the transaction of the change that caused it:
await withTransaction(async (tx) => {
  // ...the change...
  await appendPersonEvents(
    companyId,
    [
      {
        personId,
        type: "attendance",
        occurredAt,
        source: "checador:entrada-1",
        dedupeKey: attendanceDedupeKey("2026-11-03"),
        payload: { site_id, first_in: "08:12", last_out: "17:01", punches: 2 },
      },
    ],
    tx,
  );
}, companyId);

// One person, newest first, 50 at a time:
const page = await listPersonEvents(companyId, personId, { limit: 50 });
const older = await listPersonEvents(companyId, personId, {
  before: page.next,
});
```

- `appendPersonEvents(companyId, events, executor?)` inserts in batches of 500
  rows and returns how many it inserted. A person outside the company is a
  `CompanyReferenceError` on `personId`.
- `listPersonEvents(companyId, personId, { types?, before?, limit? })` reads at
  most 200 rows per page through `person_events_person_time_idx`, and returns
  nothing for a person of another company. It is an HR/company read; employee
  routes call it with the guard's `personId` only (W2-01).

Writing the events from each flow, and the backfill, is W2-13.

## Retention

`RETENTION_YEARS` in `src/lib/timeline` says how long each type is kept,
counted from `occurred_at`:

| Type                                            | Kept                        |
| ----------------------------------------------- | --------------------------- |
| `attendance`, `incidencia`                      | 5 years                     |
| `vacation`, `receipt`, `document`, `employment` | while the person row exists |

Five years is the longest of the conservation periods that apply to labor
records (LFT, IMSS and SAT). HR confirms the legal period before the job is
scheduled; changing it is one constant.

`npm run db:prune-person-events` runs the job (`deleteExpiredPersonEvents`) as
the database owner: per company, 100 people and one type per `DELETE`, each a
range scan of the person index, so it needs no index of its own and never holds
locks for long. Whether it runs from a Vercel cron or by hand is a platform
setting, so it is not scheduled here. ARCO requests are answered from the same
rows.

## Measured size and speed

`npm run db:measure-timeline -- --people 500 --runs 100` loads a throwaway
company with five years of daily attendance per person, a receipt every 15 days
and two documents a year, times the one-person read with `EXPLAIN ANALYZE` and
deletes the company at the end. Use it on a local Postgres or on a Neon branch
made for the test, never on the production branch.

On a local Postgres 16 (2026-11-04), 500 people, 979,500 rows:

| What                                      | Measured                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| Plan of the one-person read (`LIMIT 200`) | `Limit` → `Index Scan` on `person_events_person_time_idx`, no sort        |
| Execution time over 100 people            | p50 0.13 ms, p95 0.18 ms, max 0.23 ms                                     |
| Table                                     | 206 MB                                                                    |
| Indexes                                   | 224 MB (person index 118 MB, primary key 38 MB, dedupe 59 MB, site 10 MB) |

That is 430 MB of the 1 GB of storage on the Neon Free plan for 500 people
over five years, almost all of it attendance. The Neon measurement in region
(the acceptance check of under 20 ms) and the storage budget belong to P-03.
