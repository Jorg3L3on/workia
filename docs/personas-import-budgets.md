# Personas import/export: scale budgets

Plania: WRK-I3-12. The numbers below are the budgets `npm run import:budgets`
enforces; they were measured on a 5,000-person file (16,000 rows with contract
history and seeded errors) against a local Postgres.

## How to run

```bash
npm run db:seed          # local database with the demo admin
npm run import:budgets   # refuses to run unless DATABASE_URL is localhost
npx playwright test e2e/personas-import.spec.ts   # full round trip in the browser
```

The script generates the fixture (`src/lib/import/testing/fixture.ts`), runs
`ANALYZE`, then parses, stages, validates, applies (killing the process halfway
and resuming), exports, re-imports the export, undoes the import and finally
stages the file again with "Todo o nada", which must refuse it after
re-validating. It fails if a budget is
exceeded, if the resumed apply leaves duplicates or unapplied rows, if the
re-import of the export is not all "unchanged", or if the undo does not leave
the database as it was.

## Budgets and last measurement

| Step                       | Time budget | DB statements | Slowest request |
| -------------------------- | ----------- | ------------- | --------------- |
| Parse the file (Node)      | 15 s        | -             | -               |
| Stage rows (32 chunks)     | 10 s        | 80            | -               |
| Validate                   | 30 s        | 400           | 30 s            |
| Apply (killed + resumed)   | 60 s        | 2,500         | 30 s            |
| Export (memory growth)     | 15 s        | -             | -               |
| Re-import of the export    | 40 s        | 500           | -               |
| Undo                       | 40 s        | 2,500         | 30 s            |
| "Todo o nada" (revalidate) | 40 s        | 500           | 30 s            |

Export memory budget: 200 MB growth (it streams one page of 500 people at a
time). Time budgets are for a local database; against Neon the statement
counts are the portable number, because every statement adds a network round
trip. Statement counts are bounded per chunk of 500 rows (validate) or batch
of 200 rows (apply, undo), not per row. "Slowest request" is the longest
single step the page would send (one validate, apply or undo call); it must
stay well under the 60 s function limit (`maxDuration` on validate, apply and
undo).

### Measured on LOCAL Postgres (WRK Iniciativa 1, 21 oct 2026)

**Local only, not Neon.** Postgres 16 on the shared 4-core dev box, 5,000
people / 16,000 rows (contract history and seeded errors), `ANALYZE` after
loading. "Before" is `main` at 9e6228a; "after" is this change. Both ran back
to back on the same database. Timings move a lot with machine load (an
earlier run of the same code, with other test suites running, took 138 s to
undo and 34 s to apply), so compare the statement counts first.

| Step                     | Before (9e6228a) | After         | Slowest request (after) |
| ------------------------ | ---------------- | ------------- | ----------------------- |
| Parse                    | 0.4 s            | 0.4 s         | -                       |
| Stage                    | 1.9 s, 36        | 2.1 s, 68     | -                       |
| Validate                 | 3.7 s, 393       | 3.3 s, 385    | 0.2 s                   |
| Apply (killed + resumed) | 11.7 s, 1,238    | 11.4 s, 1,222 | 1.1 s                   |
| Export                   | 1.1 s, +9 MB     | 1.0 s, +8 MB  | -                       |
| Re-import of the export  | 6.3 s, 451       | 4.9 s, 474    | -                       |
| Undo                     | 14.6 s, 1,421    | 16.4 s, 1,421 | 0.3 s                   |
| "Todo o nada"            | (one request)    | 3.1 s, 419    | 0.4 s (31 requests)     |

- Stage has one more statement per chunk: the count of stored rows behind the
  server-side row limit.
- Validate no longer reads every Personas row in each chunk: duplicates are
  found once per run and Horarios/Contratos chunks read only their own
  people's rows. At 5,000 people that saves little time; it removes the cost
  that grew with the square of the file.
- "Todo o nada" used to validate the whole file inside the first apply
  request; now it is 31 short requests (the slowest 0.4 s) before applying.
- No step came near 30 s locally, so apply and undo keep batches of 200.
- Before/after outcomes of validation were also compared row by row on a
  1,600-person file with tricky keys (lower case, spaces, non-breaking spaces,
  numbers in CURP/ID cells, duplicates across chunks): identical.

**Pending: the same measurement against a Neon branch** (never production),
which is what the acceptance criteria ask for. Statement counts carry over;
times there are dominated by round trips.

### With several companies (WRK-I4-11)

`npm run import:budgets -- --company <slug>` runs in one company (default
company otherwise). Measured with three companies loaded (Empresa Demo,
Comercial del Norte and Ferretera Mandiola): parse 0.2 s, stage 1.1 s / 36,
validate 1.9 s / 393, apply 6.4 s / 924, export 0.6 s (+12 MB), re-import 3.5 s
/ 451, undo 9.6 s / 1,421. Validate, re-import and undo kept the same
statement counts as with one company; apply ran 924 instead of 1,030. Every
budget holds. On a freshly seeded database run `ANALYZE` first: before the
planner has statistics, undo took up to 70 s.

## Limits

- 5,000 people (Personas rows), 5,000 Horarios rows, 10,000 Contratos rows
  and 10 MB per file. The server counts the rows it stored; it does not trust
  the `totalRows` the browser announces.
- Apply and undo run in transactions of 200 rows, one step per request, so a
  request stays well under the function time limit; the page loops until done.
