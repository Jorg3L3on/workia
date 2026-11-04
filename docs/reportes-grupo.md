# Reportes → Tablero del grupo

Plantilla, rotación and ausentismo of every subsidiary side by side, by
empresa, región and sucursal. Workia 2.0 task W2-25, on top of the
absenteeism report ([reportes-ausentismo.md](reportes-ausentismo.md), W2-20)
and transfers ([transfers.md](transfers.md), W2-24). Page
`/app/reportes/grupo`, code in `src/lib/reports/group`. No migration, no new
table, no new permission.

## Who sees which companies

`loadGroupReportReader(userId)` lists, on every request:

- each company where the user's role has `reports:read`, the permission of
  the per-company reports;
- every active company when the user has the group admin grant
  (`users.is_group_admin`, given at `/admin/grupo`, W2-24).

A company the user may not read is never queried, even when the URL asks
for it. The sidebar shows **Reportes → Grupo** when the user has
`reports:read` in the active company and belongs to more than one company;
a group admin with one membership opens the URL directly.

## Where the numbers come from

Nothing is stored and nothing is counted ahead of time. Each company of the
view is read with its own id, under its own row-level security, with
`loadAbsenteeismInputs` (the same four reads as its absenteeism report) plus
its `person_links` rows, and the page computes the rest.

| Row                          | How                                                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Empresa, región, sucursal    | `buildAbsenteeismReport` over the company's inputs with no región or sucursal filter: the same function the company's report uses |
| Grupo · plantilla, días      | the companies' periods and attendance days together: plantilla, faltas and retardos add up                                        |
| Grupo · bajas, ingresos      | the same periods, without the transfers between two companies of the view                                                         |
| Grupo · rotación, ausentismo | computed from the group's own counts, never as a sum or mean of the companies' rates                                              |

So every empresa, región and sucursal row equals, number for number, the
same row of that company's «Ausentismo y rotación» for the same range
(`src/test/idor/group-dashboard.db.test.ts` checks it on a real database).

### Transfers

A transfer (W2-24) is a baja of tipo `traslado` in the company the person
leaves and a new period in the one they join. Each company keeps counting
it, as its own report does. The group does not: nobody left the group. The
dashboard finds them through `person_links` (`employment_period_id` and
`direction`) and shows them as «Traslados internos». A transfer to or from a
company outside the view (not selected, or not readable) stays a baja or an
ingreso of the group.

Plantilla needs no correction: the old period ends the day before the new
one starts, so a transferred person is counted once each day.

### Small groups

As in the per-company reports, a row whose average plantilla is under 5
(`MIN_GROUP_HEADCOUNT`) shows its bajas but not its turnover rate.

## Filters and exports

- **Filters**: the turnover report's presets or a custom range (at most 400
  days, the attendance aggregates' limit) and the companies to show. The URL
  keeps them in one `g` parameter (`g1*desde.…*hasta.…*empresa.<id>,<id>`).
  Región and sucursal are company catalogs; filter them in each company's own
  report.
- **Exports** (`/app/reportes/grupo/exportar`): the CSV is the table (grupo,
  then each empresa with its regiones and sucursales, plus the traslados
  internos); the Excel is the same table with the period, the companies and
  the definitions. Only counts and rates, no person named, so `reports:read`
  is enough. Each export is audited as `report_export` in every company it
  includes.

## Cost

Per company of the view: five reads (employment periods, sucursales,
regiones, two attendance aggregates that range-scan
`person_events_person_time_idx`, and `person_links`), two companies at a
time, so a page view holds a handful of connections. A company costs what one
view of its absenteeism report costs (about 10 ms of aggregates for a hundred
people and a month, docs/aggregates.md). No index, no table and no job, well
inside Neon Free.

## Not here

- Regiones of different companies are separate catalogs and are not merged
  by name.
- Company rows link to «Ver reporte» only for the active company; to open
  another company's report, switch company first.
