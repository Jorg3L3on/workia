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

The script generates the fixture (`src/lib/import/testing/fixture.ts`), then
parses, stages, validates, applies (killing the process halfway and resuming),
exports, re-imports the export and undoes the import. It fails if a budget is
exceeded, if the resumed apply leaves duplicates or unapplied rows, if the
re-import of the export is not all "unchanged", or if the undo does not leave
the database as it was.

## Budgets and last measurement

| Step                     | Time budget | DB statements | Measured (local) |
| ------------------------ | ----------- | ------------- | ---------------- |
| Parse the file (Node)    | 15 s        | -             | 0.3 s            |
| Stage rows (10 chunks)   | 10 s        | 60            | 1.1 s, 36        |
| Validate                 | 30 s        | 400           | 2.5 s, 393       |
| Apply (killed + resumed) | 60 s        | 2,500         | 6.6 s, 1,030     |
| Export (memory growth)   | 15 s        | -             | 0.7 s, +24 MB    |
| Re-import of the export  | 40 s        | 500           | 3.7 s, 451       |
| Undo                     | 40 s        | 2,500         | 8.3 s, 1,421     |

Export memory budget: 200 MB growth (it streams one page of 500 people at a
time). Time budgets are for a local database; against Neon the statement
counts are the portable number, because every statement adds a network round
trip. Statement counts are bounded per chunk of 500 rows (validate) or batch
of 200 rows (apply, undo), not per row.

## Limits

- 5,000 people (Personas rows) and 10 MB per file.
- Apply and undo run in transactions of 200 rows, one step per request, so a
  request stays well under the function time limit; the page loops until done.
