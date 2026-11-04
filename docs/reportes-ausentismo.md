# Reportes → Ausentismo y rotación

Absenteeism and turnover of one subsidiary (the active company) by región and
sucursal. Workia 2.0 task W2-20. Page `/app/reportes/ausentismo`
(`reports:read`), code in `src/lib/reports/absenteeism`, migration
`0050_absenteeism_views` (saved views only).

## Where the numbers come from

Nothing is stored and nothing is counted ahead of time: every number is
computed when the page or the file is read.

| Number                               | Source                                                                                                               | Sucursal it counts for                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Plantilla, ingresos, bajas, rotación | the turnover report's periods (`loadTurnoverFacts`) and `summarize()` ([reportes-rotacion.md](reportes-rotacion.md)) | the one the period reports in Rotación: frozen at its baja, the current one while open |
| Faltas, ausentismo                   | `absenteeismBy(…, { by: "site" })` ([aggregates.md](aggregates.md))                                                  | the person's current sucursal (`people.site_id`)                                       |
| Retardos                             | `incidenciasBy(…, { by: "site" })`, kind `retardo`                                                                   | the person's current sucursal                                                          |

- **Rotación** = bajas with fecha de baja in the range / average plantilla ×
  100, the turnover report's definition. Voluntaria and involuntaria follow the
  motivo's classification.
- **Ausentismo** = faltas in force / (days with an attendance row + faltas) × 100. There is no schedule: the expected days come from those two rows.
- **Región** is the sucursal's current región. Sucursales without one, and
  people without a sucursal («Sin sucursal»), go under «Sin región», last.
- Each región and the total are computed from their own rows, never as a sum
  or mean of rates.
- A group whose average plantilla is under 5 (`MIN_GROUP_HEADCOUNT`) shows
  its bajas but not its turnover rate, as in Rotación.
- A deleted sucursal shows only while it still has numbers in the range.
- The range is at most 400 days, the most the attendance aggregates read.

## Reconciling with Rotación

The acceptance check of W2-20 is that turnover reconciles with the existing
report to the person. It does by construction, because both read the same
periods with the same functions:

- The total's bajas and plantilla equal Rotación's for the same range.
- A sucursal's bajas and plantilla equal Rotación filtered to that sucursal
  («Ver en Rotación» on each row opens exactly that).
- The Excel's «Bajas» sheet lists the same periods as Rotación's «Bajas»
  sheet for the range, with the región and sucursal each one counts for.

`src/test/idor/absenteeism.db.test.ts` checks all three against a real
database, including a person who changed sucursal after their baja.

Rotación's «Por sucursal» breakdown folds sucursales under 5 into «Otros»;
this report lists every sucursal and only hides the rate.

## Filters, views and exports

- **Filters**: the turnover report's presets (whole closed months) or a custom
  range, región and sucursal (both narrow the rows and the total; with either,
  people without a sucursal are left out). The URL keeps them in one `a`
  parameter (`a1*desde.…*hasta.…*region.…*sucursal.…`).
- **Saved views**: `people_views` with kind `absenteeism`, like Rotación's:
  personal or shared read-only, a preset stays relative, 50 per person, only
  the owner deletes.
- **Exports** (`/app/reportes/ausentismo/exportar`, audited as
  `report_export`): the CSV is the table by región and sucursal
  (`reports:read`). The Excel adds «Bajas» and «Ausentismo por persona», so
  it names people and also needs `people:read` and `people:export`.

## Cost

Three reads per page view: the company's employment periods (as Rotación),
and two aggregate statements that start from the company's people and range
scan `person_events_person_time_idx` per person (about 10 ms for a hundred
people and a month, docs/aggregates.md). No new index, no new table, and the
migration only widens a check constraint.

## Not here

Several subsidiaries side by side is W2-25 (group dashboards), which needs the
group admin role of W2-24. The HR assistant's tools over these numbers are
W2-23.
