# Aggregates and the period-close snapshot

The numbers the app shows, and the incidencias pre-nómina reads. Workia 2.0
task P-02, built on the [person timeline](timeline.md). Migration
`0035_pay_periods`, schema `src/lib/db/schema/pay-periods.ts`, helpers
`src/lib/timeline/aggregates.ts` and `src/lib/pay-periods`.

## The rule

Every number is an aggregate over `person_events`, computed when it is read,
through an index. There are no counters, no triggers, no queue and no
reconciliation job, so there is nothing that can drift from the events.

The one stored summary is `incidencias_period_snapshot`: when HR closes a pay
period, its incidencias are frozen in the same transaction as the close.
Pre-nómina reads the snapshot, never the live numbers, so an incidencia written
after the close does not change what was sent to payroll.

## Aggregate helpers

```ts
import { absenteeismBy, incidenciasBy } from "@/lib/timeline/aggregates";

const range = { from: "2026-11-01", to: "2026-11-30" }; // local days, inclusive

await incidenciasBy(companyId, range, { by: "person" });
await incidenciasBy(companyId, range, { by: "site", siteId });
await absenteeismBy(companyId, range, { by: "month", personIds: [personId] });
```

- `incidenciasBy` returns one row per group and kind: `{ key, kind, count,
justified, minutes }`. `count` is days with that incidencia.
- `absenteeismBy` returns one row per group: `{ key, presentDays, absentDays,
justifiedAbsentDays, rate }`. A present day is an attendance row; an absent
  day is a falta in force; `rate = absentDays / (presentDays + absentDays)`.
  The expected workdays come from those rows, not from a schedule.
- `by` is `person` (key = person id), `site` (key = the person's
  `people.site_id`, null for people without a site) or `month` (key =
  `YYYY-MM`). The site is the person's current site, as in the today view
  (P-04), not a field of the event.
- Every helper starts from the company's people (one site's through
  `people_site_id_idx`, or `personIds`) and reads each person's window with
  one range scan of `person_events_person_time_idx`. It needs no index of its
  own, so it keeps working after P-04 drops `person_events_site_day_idx`. A
  range is at most 400 days. An id of another company returns nothing.

### What the helpers read

The helpers define how W2-12 and W2-14 write the rows they count:

| Type         | Day                             | Fields read                                                |
| ------------ | ------------------------------- | ---------------------------------------------------------- |
| `attendance` | the dedupe key (`attendance:…`) | `site_id`                                                  |
| `incidencia` | `payload.date` (`YYYY-MM-DD`)   | `kind`, `minutes`, `justified`, `site_id`, `rev`, `voided` |

`person_events` is append-only, so a correction of an incidencia (justified
later, minutes fixed, cancelled) is a new event with the same `date` and
`kind`, the full payload and a higher `rev` (0 when missing). The highest `rev`
of each (person, day, kind) is the one in force; `voided: true` cancels it.

`occurred_at` only narrows the index range (a day either side of the local
days, enough for every Mexican time zone); the local `date` decides which day
an incidencia counts for.

## Pay periods

Every company pays quincenal: `YYYY-MM-Q1` is days 1 to 15 and `YYYY-MM-Q2`
the 16th to the end of the month (`quincenaOf`, `quincenaRange`).

| Table                         | What                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `pay_periods`                 | one row per company and quincena once it is first closed: status, closed_at, revision             |
| `incidencias_period_snapshot` | per closed period, person and kind: count, justified, minutes. Primary key (period, person, kind) |

```ts
import {
  closePayPeriod,
  readPeriodSnapshot,
  reopenPayPeriod,
} from "@/lib/pay-periods";

await closePayPeriod(companyId, "2026-11-Q1", { actorUserId });
await readPeriodSnapshot(companyId, "2026-11-Q1"); // null while open
await reopenPayPeriod(companyId, "2026-11-Q1", { reason, actorUserId });
```

- **Close** (`closePayPeriod`), one transaction: create the period row if
  needed and lock it, refuse it if already closed, insert the snapshot with
  one `INSERT … SELECT` from the same SQL as `incidenciasBy` (by person),
  mark it closed, add 1 to `revision`, and record an audit event
  (`pay_period` / `close`). If any step fails, nothing is written: the
  fault-injection tests in `src/test/idor/pay-periods.db.test.ts` break the
  snapshot insert and the status update with a trigger and check that the
  period stays open with no snapshot.
- **Reopen** (`reopenPayPeriod`), one transaction: needs a reason, deletes
  the snapshot, marks the period open and records an audit event
  (`pay_period` / `reopen`) with the reason and the revision it reopened. The
  next close writes a new snapshot as the next revision.
- A person with no incidencias in the period has no snapshot row.
- The app role may not delete a period nor update a snapshot row: the snapshot
  changes only by reopen (delete) and close (insert). Both tables have company
  RLS and composite foreign keys to the company's people and periods.

The pre-nómina file is W2-18 ([prenomina.md](prenomina.md)); migration 0052
adds to the snapshot what justified each incidencia, so it counts permisos,
incapacidades and vacations apart. The engine that writes the incidencias, its
rules and HR's justifications are in [incidencias.md](incidencias.md) (W2-14).

## Close wired to the engine and the screens (W2-15)

- **Engine writes.** `replacePeriodIncidencias` (W2-13, the writer the W2-14
  engine calls) takes a quincena and calls `lockOpenPayPeriod` first: it
  creates the period row if needed, locks it `FOR SHARE` and refuses a closed
  period (`PayPeriodError` `period_closed`). The close locks the same row `FOR
UPDATE`, so a close waits for an engine write in flight and snapshots its
  result, and an engine write after a close is refused until a reopen. The
  lock is on `pay_periods` because `workia_app` has UPDATE there (which
  `FOR SHARE` needs) and not on `person_events`.
- **Check.** `verifyPeriodSnapshot(companyId, period)` recomputes a closed
  period with the statement the close inserted from and compares it row by
  row with the snapshot (null while open). The screen shows whether they still
  match; a difference means an incidencia of the period was appended after the
  close by something other than the engine. Pre-nómina keeps reading the
  snapshot until HR reopens and closes again.
- **Screens.** Periodos de pago (`/app/periodos`, `pay_periods:read`) lists
  the quincenas newest first, 12 a page: the calendar is generated and the
  rows are read by `(company_id, period)`, with the last period as the cursor
  and no OFFSET (`listPayPeriods`). A quincena (`/app/periodos/2026-11-Q1`)
  shows its totals and its people in name order (`getPayPeriodDetail`, 100 a
  page after a cursor): the snapshot once closed, the live aggregate while
  open. Close (behind a confirm) and reopen (with a reason) need
  `pay_periods:manage`; a quincena that has not started cannot be closed.
  Both permissions go to the admin role; run `npm run db:sync-permissions`
  after deploying.
- **MCP.** `get_incidencias_summary` (aggregates over a range, by person,
  site or month, with absenteeism) and `get_pay_period` (status, revision,
  snapshot or live rows, and whether the snapshot still matches), both
  read-only with `pay_periods:read`. Closing and reopening stay in the app.
- **Today counts.** `todayCounts(companyId, scope, day)` in
  `src/lib/timeline/today.ts` gives the roster, present, absent, late and
  left-early counts of one site, area or manager's team for a day from
  `absenteeismBy` and `incidenciasBy`, for W2-17's header.

Not here: the approvals inbox and its index belong to W2-06, which creates
the requests table (docs/keyset.md).

## Measured

`npm run db:measure-aggregates -- --people 500 --years 5` loads a throwaway
company (five sites of a hundred people, five years of attendance Monday to
Saturday, a falta and a retardo on about one day in thirty-two each), times
the aggregates with `EXPLAIN ANALYZE`, closes every quincena and deletes the
company. Use a local Postgres or a Neon branch made for the test.

On a local Postgres 16 (2026-11-04), 806,819 events, without
`person_events_site_day_idx` (as after P-04's 0036):

| What                                        | Execution            | Index                                                 |
| ------------------------------------------- | -------------------- | ----------------------------------------------------- |
| Site absenteeism, one month, 100 people     | 9.8 ms               | `people_site_id_idx`, `person_events_person_time_idx` |
| Site incidencias, one month, 100 people     | 2.2 ms               | `people_site_id_idx`, `person_events_person_time_idx` |
| Incidencias by person, one month, 500       | 13.0 ms              | `person_events_person_time_idx`                       |
| Absenteeism by site, one month, 500         | 25.9 ms              | `person_events_person_time_idx`                       |
| One quincena by person (what a close reads) | 6.1 ms               | `person_events_person_time_idx`                       |
| Absenteeism by month over a year, 500       | 239 ms               | none: the planner scans the table for a whole year    |
| A close, from the app (120 quincenas)       | p50 22 ms, p95 28 ms | —                                                     |

A year of the whole company is a report, not a screen: at that range a
sequential scan is the planner's cheaper choice. Five years of snapshots for
500 people: about 40,500 rows, 4 MB of table and 4 MB of primary key, next to
the 430 MB of `person_events` measured in P-01. The in-region Neon numbers
belong to P-03.
