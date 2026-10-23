# Reportes → Rotación

The turnover report of the active company (`/app/reportes/rotacion`). Plania:
WRK-I12. It reads employment periods (`employment_periods`, migration 0025)
and never writes them. Who sees it: `reports:read` (admin and super_admin by
default). The people behind a number need `people:read`; exports need
`people:export`; the finiquito only appears with `compensation:read`.

Code: `src/lib/reports/turnover/` — `data.ts` loads, `metrics.ts` and
`report.ts` compute (pure), `index.ts` puts them together. Every number the
dashboard, the drill-down and the exports show comes from
`buildTurnoverReport()`, so they always agree.

## Definitions

All of them inside the active company, with `company_id` filtered explicitly
(row-level security is not on in production yet). Dates are `date` (no time);
months are calendar months.

| Metric                               | Formula                                                                               | Notes                                                                                                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Baja**                             | A period with `fecha_baja` in the range.                                              | Every closed period counts: someone who leaves, comes back and leaves again is 2 bajas and 2 ingresos. Bajas «sin fecha» never count; they show in a review banner. Deleted expedientes are left out.                |
| **Active on day d**                  | (`fecha_ingreso` ≤ d or unknown) and (`fecha_baja` null or ≥ d), not «sin fecha».     | The day of the baja still counts as active (last day worked). Used by cohorts.                                                                                                                                       |
| **Active at the close of day d**     | Same, but `fecha_baja` > d.                                                           |                                                                                                                                                                                                                      |
| **Plantilla of a month**             | (active on the 1st + active at the close of the last day) / 2.                        | Whoever leaves on the last day is a baja of that month and in neither its final nor the next month's plantilla. The daily average (Σ days active / days of the month) is shown as support, never as the denominator. |
| **Plantilla of several months**      | Mean of the monthly plantillas.                                                       | A range that is not whole months: (active on its first day + active at the close of its last) / 2.                                                                                                                   |
| **Rate**                             | bajas / plantilla × 100.                                                              | A quarter or a year divides its bajas by its mean plantilla: monthly rates are never summed or averaged. Plantilla 0 → no rate («—»). Someone hired and gone in the same month counts (BLS/ISO criterion).           |
| **12 months**                        | bajas of the last 12 months / mean of their 12 monthly plantillas × 100.              | With less than 12 months of history (since the first recorded baja) it is «estimada»: 1 − (1 − mean monthly rate)^12.                                                                                                |
| **Voluntaria / involuntaria / otra** | The motivo's classification (`termination_reasons.classification`).                   | A motivo not classified yet counts as «otra». A baja without motivo uses its tipo: voluntaria → voluntaria; despido, término de contrato → involuntaria; otra or none → otra. The three rates add up to the total.   |
| **Salida en prueba**                 | Bajas with `fecha_baja − fecha_ingreso` < 90 (day 90 included, ingreso is day 1).     | Not renewing the 90-day contract counts. Always the period's own `fecha_ingreso`, never recognized seniority: a rehire starts over. Share = of the bajas with a known ingreso; also shown per ingreso of the range.  |
| **Retention at 30/60/90 days**       | Of the periods that started in month M, % active on `fecha_ingreso + 30/60/90`.       | A cell is «en curso» until the last day of M plus those days has passed.                                                                                                                                             |
| **Reingresos**                       | Periods started in the range that are not the person's first / ingresos of the range. | Plus how many came back after leaving with «recontratable = no».                                                                                                                                                     |
| **Antigüedad al salir**              | Days of the period (ingreso = day 1) of the bajas of the range.                       | Mean and median; buckets 0–30, 31–60, 61–90 days, 3–6 and 6–12 months, 1–3 and 3+ years.                                                                                                                             |
| **Periods without fecha de ingreso** |                                                                                       | Count in the plantilla as active since always and their baja counts; out of cohorts, salida en prueba, reingresos and antigüedad.                                                                                    |

**Filters.** Área, sucursal, puesto and jefe (direct reports, or the whole
team below) narrow the population: bajas and plantilla. Tipo, motivo and
clasificación narrow only the bajas, so «rotación voluntaria» keeps the whole
plantilla as its denominator.

**Dimensions of a baja.** A period freezes the área, sucursal, puesto and jefe
of the person when it closes (migration 0027; `recordTermination`,
`correctTermination` and `syncEmploymentPeriods`). Open periods use the
person's current ones. So, per área, the denominator mixes frozen values
(closed periods) and current ones (open periods): exact for bajas,
approximate for people who moved while active, until there are snapshots.

**Small numbers.** Rates always show next to their counts. A group (área,
sucursal, puesto, jefe) whose plantilla is under 5 goes to «Otros», which shows
no rate of its own while it is under 5 too. A plantilla under 10, or a cohort
under 5 hires, is flagged «muestra pequeña».

**Goal.** `companies.turnover_goal_pct`: a monthly % with no default, edited
on the dashboard with `settings:update`. For a range it scales with its months
(a quarter compares against 3 × the goal). No goal: no goal line and no colors
by goal.

## Data quality

- Bajas «sin fecha» and dates inferred by the employment-periods backfill
  show in a banner that opens Personas filtered by «Revisión de baja».
- The import refuses a row with Estatus Baja and no motivo (WRK-I12): every
  new baja carries its motivo, so its classification is known.
- Motivos created before migration 0027 have no classification until HR picks
  one in Catálogo → Motivos de baja; the dashboard counts them.

## Rollout

After `npm run db:migrate` (0027) in an environment:

1. `npm run db:sync-permissions` (adds `reports:read` to admin and
   super_admin), or the menu entry does not show.
2. `npm run db:backfill-turnover-dimensions` (dry run), then with `--apply`:
   closed periods get the área, sucursal, puesto and jefe of their person.
   Run it once, right after the migration: it fills periods that have none,
   from the person as they are when it runs.

## Performance

Measured on a local Postgres 16 with synthetic data (one company, 5,000
people, 8,000 periods, 5,000 of them closed), 22 runs after warm-up:

| What                                                                        | p95                                                          |
| --------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Loading the periods (`loadTurnoverFacts`)                                   | 73 ms (SQL execution 13 ms: one hash join, sequential scans) |
| The whole report (`getTurnoverReport`, loading + every metric, with detail) | 160 ms                                                       |

Budget: 300 ms per dashboard. No cache and no index per área or jefe until a
measurement on Neon fails the budget (decision b36e7e24); the only new index
is `employment_periods (company_id, fecha_ingreso)`. Production companies have
tens of periods today.
