# Pre-nómina

Workia 2.0 task W2-18. HR closes a quincena and hands the payroll provider a
file it imports without edits. Migration `0052_prenomina`, code in
`src/lib/prenomina`, screens on `/app/periodos/<quincena>` and
`/app/periodos/plantillas`, the file at
`/app/periodos/<quincena>/prenomina?plantilla=<id>`.

Workia computes no salary: the file carries days and minutes only.

## Approval and lock

Closing the quincena (W2-15, `pay_periods:manage`) is the approval and the
lock. The close runs the incidencias engine one last time and freezes the
result in `incidencias_period_snapshot`; the pre-nómina reads only that
snapshot. While the quincena is closed the engine and every HR decision on it
are refused, so the file cannot change. To change it, HR reopens the quincena
with a reason (audit `pay_period` / `reopen`), fixes what was wrong and closes
it again: that is the next revision, and the file name carries it
(`prenomina-<empresa>-2026-11-Q1-r2-<plantilla>.xlsx`). An open quincena has
no pre-nómina: the card says to close it, and the route answers 409.

## What it counts

Per person, from the snapshot (`totalsFromSnapshot` in `rows.ts`):

| Concept                  | From                                                              |
| ------------------------ | ----------------------------------------------------------------- |
| `faltas`                 | faltas not justified                                              |
| `vacaciones`             | faltas justified by a vacation (`justification_ref` `vacation:…`) |
| `permisos_con_goce`      | faltas justified by `permiso_con_goce:…`                          |
| `permisos_sin_goce`      | faltas justified by `permiso_sin_goce:…`                          |
| `incapacidades`          | faltas justified by `incapacidad_imss:…`                          |
| `faltas_justificadas_rh` | the other justified faltas (HR overrides)                         |
| `retardos`               | retardos not justified                                            |
| `minutos_retardo`        | their minutes                                                     |
| `salidas_anticipadas`    | salidas anticipadas not justified                                 |
| `minutos_salida`         | their minutes                                                     |

A day counts only when the person had a shift (the engine writes no
incidencia on a rest day), so `vacaciones` are vacation days on workdays.
Voided incidencias never reach the snapshot.

To count these from the snapshot, 0052 adds five columns to
`incidencias_period_snapshot`, filled by the close from the same statement as
before (`incidenciasByPersonSql`): `justified_vacation`,
`justified_permiso_con_goce`, `justified_permiso_sin_goce`,
`justified_incapacidad` and `justified_minutes`. `verifyPeriodSnapshot`
compares them too. A quincena closed before 0052 has zeros there and reads as
HR overrides until it is reopened and closed again (the data so far is test
data).

The quincena card shows the company's totals of these concepts and the
number of people with incidencias.

## Templates

The payroll provider is not chosen yet, so nothing is specific to one. A
template (`prenomina_templates`, validated by `template.ts`) says:

- **Format:** Excel (`.xlsx`) or CSV.
- **Rows:** one per person ("wide": each concept a column) or one per person
  and concept ("long": the "movimientos" import most providers take, with the
  provider's code for each concept; only concepts with a code and a value
  other than 0 are written).
- **Columns, in order**, each with its header: identifiers (CURP, RFC, NSS,
  Workia id, checador number), name fields, sucursal, the quincena
  (`2026-11-Q1`), its number in the year (1 to 24), its first and last day,
  a fixed text, and the concepts (wide) or concept code, name and amount
  (long).
- **CSV:** delimiter (`,` `;` `|` tab), encoding (UTF-8 with BOM, UTF-8,
  Latin-1), header row or not.
- **Dates:** `2026-11-01`, `01/11/2026`, `01-11-2026` or `20261101`.
- **Skip empty:** in wide, leave out people whose selected concepts are all 0.

Every company has the built-in template «Workia (genérica)» (Excel, wide,
every concept); it can be copied, not changed. A template is archived, never
deleted; create, change and archive leave audit events
(`prenomina_template`). Managing templates needs `pay_periods:manage`.

Before the download, the card says how many rows the file has and how many
people lack an identifier the template uses (CURP, RFC, NSS, checador), so HR
fixes the expediente rather than the file.

## The file

`exportPrenomina(companyId, period, templateId)` builds the file in memory
(a quincena is at most a few thousand rows) and records an audit event
(`prenomina_export` / `export`) with the period, revision, template, rows,
people and the file's SHA-256, so a file the provider received can be
matched to a revision. In Excel, text cells are text (a leading zero in an
NSS or checador survives) and amounts are numbers. The route needs
`pay_periods:read` and `people:export`, because the file has CURP, RFC and
NSS.

Not here: an employee number field (W2-03 learns one from receipts,
`payroll_employee_numbers`, in another PR), people with no incidencias in a
wide file, and anything about money.

## Cost on Neon Free

One small table (a row per template) and five integer columns on the
snapshot. The card reads the period's snapshot once (a range scan of its
primary key) and the people in it, and checks every template in memory. No
cron, no queue, no stored files.
