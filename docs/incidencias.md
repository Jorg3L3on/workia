# Incidencias engine

Workia 2.0 task W2-14. The engine turns each person's punches (W2-12) and the
schedule in effect into faltas, retardos and salidas anticipadas, marks them
justified or void from HR's decisions, and writes them to `person_events`
with `replacePeriodIncidencias` (W2-13, W2-15). The period close (P-02,
W2-15) freezes them for pre-nómina. Migration `0051_incidencias_engine`,
code in `src/lib/incidencias`, screens under `/app/periodos`.

Overtime is not computed.

## When it runs

| Trigger                                           | What it recomputes                                             |
| ------------------------------------------------- | -------------------------------------------------------------- |
| Any ingestion (CSV, device push, app, QR)         | The people and quincenas the new punches touched               |
| HR assigns a checador number                      | The days of the punches that were waiting on that number       |
| A permiso, incapacidad or override, or its cancel | That person's quincenas of those days, in the same transaction |
| «Recalcular incidencias» on a quincena            | The whole quincena                                             |
| «Cerrar quincena»                                 | The whole quincena, right before the close takes the snapshot  |

Every run is `runIncidencias(companyId, period, { personIds?, asOf? })`: it
holds the period open (`lockOpenPayPeriod`, FOR SHARE), loads one batch of
200 people at a time and writes the result. A closed quincena is refused
(`PayPeriodError` `period_closed`) and nothing is written; an ingestion into
a closed quincena still stores the punches, skips the recompute, and the
incidencias change only after a reopen. The recompute after an ingestion
runs once the ingestion has committed, so a failure there never loses
punches: it is logged and the next trigger recomputes.

A shift is judged once it has ended (`asOf`, now by default), so a running
quincena fills in day by day. A day with no punches is a falta: if a
checador's export has not been uploaded yet, its days show faltas until it
is, and the upload removes them.

## Which shift applies

From `src/lib/incidencias/schedule.ts`, for each day:

1. The contract that covers the date (start to end, not deleted) and has a
   schedule; the latest one when two overlap. A new contract in the middle of
   a quincena changes the shifts from its start date.
2. Otherwise the person's own schedule (`person_schedules`).
3. Otherwise no shift and no incidencias.

A schedule by blocks (WRK-I5-3) works the weekdays of its blocks; a simple
schedule works every day but its rest day (Sunday when none is set). An exit
at or before the entry is a night shift that ends the next day and belongs to
the day it starts; the block editor accepts it when it lasts at most 14
hours.

No incidencias on: days outside an employment period (`employment_periods`,
ingreso to baja; every day when the person has none), and the mandatory rest
days of LFT article 74 (1 January, first Monday of February, third Monday of
March, 1 May, 16 September, third Monday of November, 25 December, and 1
October every six years from 2024). Election days change each time: HR voids
those faltas with an override.

## From punches to incidencias

Each punch goes to the nearest shift (distance 0 inside it), up to six hours
away, so a night shift's exit after midnight belongs to the night before and
an early arrival to the shift it is early for. Then, per shift:

- A punch within five minutes of the one before it is a double punch and is
  dropped.
- With two or more punches, the first is the entry and the last the exit,
  whatever kind the checador gave them (kindless exports alternate in/out by
  order, which a double punch would throw off). A single punch is an entry,
  or an exit when the source said so.
- No punches: **falta**.
- Entry later than the tolerance: **retardo**, with the minutes counted from
  the entry time. Later than the falta rule (if set): **falta** instead.
- Exit earlier than the exit tolerance: **salida anticipada**, with the
  minutes.

### Rules per company

`incidencia_rules`: the entry tolerance (default 10 minutes), the exit
tolerance (default 0) and the minutes after which a late arrival is a falta
(default none). HR changes them on `/app/periodos/reglas`; a change starts
in the next quincena (`firstPeriodForChange`), so a running quincena keeps
the rules it started with, and saving twice before then replaces the pending
change. Each save leaves an audit event (`incidencia_rules` / `update`) with
the rules before and after.

## Justifications and overrides

`incidencia_justifications` holds HR's decisions; vacations come from
`vacation_records`. For each incidencia, the first that applies wins:

1. An **override** of that day and kind (the latest one): `justify` keeps it,
   justified; `void` keeps it with `voided: true`, which the aggregates and
   the snapshot skip.
2. A **vacation** covering the day: justified, `justification_ref:
vacation:<id>`.
3. A **permiso con goce**, **permiso sin goce** or **incapacidad IMSS**
   covering the day: justified, `justification_ref: <kind>:<id>`.

Pre-nómina (W2-18) reads the kind from `justification_ref` to count
permisos, incapacidades and vacations apart. Every decision needs a reason
and leaves an audit event: `incidencia_justification` / `create` for a
permiso or incapacidad, `/ override` for an override, `/ revoke` for a
cancel. A cancel keeps the row with who cancelled it and why; the app role
cannot delete these rows. A decision on a closed quincena is refused.

W2-06 (requests and approvals) can register an approved permiso by calling
`createJustification` in its approval transaction, with the request id as
`reference`.

## What it writes

One `incidencia` event per person, day and kind, in the shape P-02 reads
(docs/aggregates.md): `date`, `kind`, `period`, `minutes`, `justified`,
`justification_ref`, `voided`, `site_id` (the day's attendance site, else the
person's). The dedupe key is `incidencia:<period>:<day>:<kind>`, so a re-run
writes nothing new. When a recompute changes a stored incidencia (justified
later, minutes fixed, voided), `replacePeriodIncidencias` writes the full
payload again with `rev` one higher than the row it replaces; an incidencia
that no longer applies (the punches arrived) is deleted.

## Screens

- `/app/periodos/reglas`: the rules in effect, the form for the next quincena
  and past changes.
- `/app/periodos/<quincena>`: «Recalcular incidencias» while open; each row
  opens that person's quincena.
- `/app/periodos/<quincena>/<person>`: the incidencias with the day's first
  and last punch, «Justificar» and «Anular» with a reason, the person's
  permisos, incapacidades and decisions with «Cancelar justificación», and a
  form to register a permiso or incapacidad.

Viewing needs `pay_periods:read`; every change needs `pay_periods:manage`
(the admin role). No new permission, so no extra `db:sync-permissions` beyond
the one W2-15 already needs.

## Cost on Neon Free

Two small tables: a row per rules change and one per HR decision. A run of
one quincena reads, per batch of 200 people, one range of attendance rows by
`(person_id, dedupe_key)` and the people's contracts, schedules, employment,
vacations and justifications, then writes only the incidencias that changed.
No cron, no queue, no counters.
