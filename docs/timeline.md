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

## Who writes what (W2-13)

Each flow builds its event in `src/lib/timeline/events.ts` and appends it in
the same transaction as the change and its `audit_events` row. If the event
cannot be written, the change rolls back too (`writes.db.test.ts` checks
that for every writer). The dedupe key names the source row, so the backfill
builds the same key for the same fact and never writes it twice.

| Event                                   | Written by                                                                          | Dedupe key                                 | `occurred_at`             |
| --------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------- |
| `employment` alta                       | `syncEmploymentPeriods` (alta, edición, importación, alta a nómina), `rehirePerson` | `employment:period:<id>:alta`              | the ingreso               |
| `employment` baja                       | `recordTermination`; a status set to baja without the dialog («sin fecha»)          | `employment:period:<id>:baja`              | the fecha de baja, or now |
| `employment` baja corrected             | `correctTermination` (append-only: a new event, `corrected: true`)                  | `employment:audit:<audit id>`              | the fecha de baja         |
| `employment` cambio                     | `updatePerson`, a renewal with a new puesto, an import that moves a person          | `employment:audit:<audit id>`              | the audit event           |
| `employment` transfer                   | builder only, for the subsidiary transfers of phase 3                               | `employment:transfer:<id>`                 | the transfer              |
| `vacation` enjoyment / void             | `registerVacationRecord` / `voidVacationRecord`                                     | `vacation:record:<id>:enjoyment` / `:void` | first day / the void      |
| `vacation` request, approval, rejection | builder only, for the requests of W2-09/W2-10                                       | `vacation:request:<id>:<kind>`             | the step                  |
| `document`                              | `recordDelivery` (status `accepted`); uploads and reviews of W2-07 pass theirs      | `document:person_document:<id>:<status>`   | the delivery date         |
| `receipt`                               | builder only, for the receipts import of W2-03                                      | `receipt:cfdi:<uuid>`                      | delivered at              |
| `attendance`                            | `writeAttendanceDays`, for the ingestion of W2-12                                   | `attendance:<date>`                        | the first punch           |
| `incidencia`                            | `replacePeriodIncidencias`, for the engine of W2-14                                 | `incidencia:<period>:<date>:<kind>`        | the day                   |

A calendar day is stored as noon in central Mexico (`dayInstant`), so it stays
on the same date in every Mexican time zone. A «cambio» is any person audit
event whose `changes` move the puesto, sucursal, área or jefe; its payload has
the new ids and the old ones (`from_position_id`…), and it keeps the audit
event's source (`app`, `mcp`, `import`). The jefe links of an import write no
audit event, so they write no cambio either; nor does an import undo.

### Attendance and incidencias without UPDATE

`writeAttendanceDays(companyId, days)` keeps one row per person per day. A day
that gets new punches is a `DELETE` of its row and an `INSERT` of the merged
one in the same transaction; a day whose punches are all stored already is
not written, so a re-run of the same file costs one read per 500 days. The
payload is `{ site_id, punches: [[instant, "in" | "out", device?], ...] }`:
tuples and no derived fields keep a day with two punches near 160 bytes.
`readAttendance(payload)` gives the punches back with `firstIn` and `lastOut`.

`replacePeriodIncidencias(companyId, { period, personIds, incidencias })`
makes the incidencias of an open pay period exactly the engine's output:
unchanged rows stay, changed and gone ones are deleted and the new ones
inserted. A closed period is frozen by P-02's snapshot.

Neither takes a row lock: `SELECT … FOR UPDATE` needs the UPDATE privilege
that `workia_app` does not have. A concurrent writer on the same rows leaves
the delete or the insert short, and the batch throws `TimelineConflictError`
and rolls back, for the job to retry.

## Backfill

`npm run db:backfill-person-timeline` (dry run; `-- --apply` writes, `--company
<slug>` limits it) builds the events of the facts stored before W2-13 with the
same builders: altas and bajas from `employment_periods`, enjoyments and voids
from `vacation_records`, deliveries from `person_documents`, and the cambios
of person audit events. Audit events without a person are left out. It runs as
the database owner, 500 source rows per transaction, and can run before,
after or while the app writes. It prints, per kind, the facts in the source
tables, the events inserted and the events stored, and exits with an error
when an applied run's counts do not match. A second run inserts nothing.

Writing the events from each flow, and the backfill, is W2-13. The numbers
over these rows, and the snapshot a pay period freezes when it closes, are in
[aggregates](aggregates.md) (P-02).

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

On a local Postgres 16 (2026-11-04), 500 people, 979,500 rows, with the
attendance payload of P-01's first measurement (a short site name and a punch
count):

| What                                      | Measured                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| Plan of the one-person read (`LIMIT 200`) | `Limit` → `Index Scan` on `person_events_person_time_idx`, no sort        |
| Execution time over 100 people            | p50 0.13 ms, p95 0.18 ms, max 0.23 ms                                     |
| Table                                     | 206 MB                                                                    |
| Indexes                                   | 224 MB (person index 118 MB, primary key 38 MB, dedupe 59 MB, site 10 MB) |

With the payload `writeAttendanceDays` stores (a site uuid and two punch
tuples, W2-13), the same load measures a 268 MB table and the same 224 MB of
indexes: 492 MB, and the one-person read p50 0.22 ms, p95 0.31 ms. Stored as
objects with `first_in` and `last_out`, attendance would have cost about
110 bytes more per row, roughly another 100 MB.

The first measurement was 430 MB of the 1 GB of storage on the Neon Free plan for 500 people
over five years, almost all of it attendance. The Neon measurement in region
(the acceptance check of under 20 ms) and the storage budget belong to P-03.
