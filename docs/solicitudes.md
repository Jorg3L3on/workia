# Solicitudes: vacaciones y permisos

Workia 2.0 W2-06. An employee asks for vacaciones or a permiso from the
employee app; their jefe approves or rejects it from the approvals inbox; HR
sees every request and decides the ones nobody else can. Days only, never
amounts. Code: `src/lib/requests`, migration `0047_time_off_requests`.

## What can be asked

| Kind               | What approval does                                               |
| ------------------ | ---------------------------------------------------------------- |
| `vacaciones`       | writes a `vacation_records` row in the same transaction          |
| `permiso_con_goce` | nothing else; the timeline row says `pay: con_goce`              |
| `permiso_sin_goce` | nothing else; the timeline row says `pay: sin_goce` (pre-nómina) |

Home office and shift swaps are out of scope.

A request has a first and a last day (Mexico dates, from today on, up to 90
days), the days the person will miss in half-day steps (never more than the
calendar days of the range) and an optional note of up to 280 characters.
The note is shown to the approver and HR only and never goes into the audit
trail, because it can carry health data; the form asks not to write any.

It is refused when it overlaps another pending or approved request of the
person or a vacation row, and a vacation request is refused when its days,
plus the person's other pending vacation requests of the same service year,
pass the entitlement (the same placement and the same LFT table as
`previewVacationRegistration`). HR can still register more from the
expediente.

## Who decides

When the request is created it stores `manager_id = currentApprover()`
(W2-07, [managers.md](managers.md)): the person's live jefe when that jefe has
a live manager grant. Null means HR decides. A later change of jefe does not
move a pending request.

- The jefe, or the backup covering for them today, decides from
  `/mi/equipo/aprobaciones`. A request of another team, in this company or
  another, reads as missing. Nobody decides their own request, also when they
  cover for their jefe.
- HR (`vacations:read` to see, `vacations:update` to decide, the permission
  that writes vacation rows) sees every request of the company in
  `/app/solicitudes` and can decide any pending one, also when the jefe cannot.
  «Las decide RH» lists the ones without a jefe.

The decision screen shows what to weigh: how many working days the range has
by the person's rest day (`person_schedules.rest_day`), whether the request
asks for more, and who else with the same jefe is off or asked to be off on
those days (pending and approved requests and vacation rows, up to ten).

## Transitions

```
pending ──approve──▶ approved ──cancel (before the first day)──▶ cancelled
   │                                     (voids the vacation row)
   ├────reject (reason required)──▶ rejected
   └────cancel──▶ cancelled
```

Each one runs in one transaction with:

- the row change (`status` checked again in the UPDATE, so two decisions never
  both apply);
- for an approved vacation, `registerVacationRecordInTx`, and for a cancelled
  one, `voidVacationRecordInTx`: the balance moves only on approval and comes
  back on cancellation; a rejection never touches it;
- an audit event, `time_off_request` with `create`, `approve`, `reject` or
  `cancel`, plus the `vacation_record` event of the row it wrote or voided. A
  manager or employee is the actor through their employee account (source
  `employee`), HR through its user;
- a `person_events` row: `vacation` or `permiso` with `kind` request,
  approval, rejection or cancellation ([timeline.md](timeline.md)). W2-14
  reads approved permisos to justify the days they cover;
- the notification of W2-08 ([notificaciones.md](notificaciones.md)):
  `request_pending` to whoever decides when the request is created (the jefe
  in `/mi`, or the HR users with `vacations:update`), `request_decision` to the
  employee when it is decided. They are written in the transaction and sent
  right after the response, so the request is in the jefe's inbox at once and
  the decision reaches the employee in the app, by email and by web push.

Only an employee cancels, from «Mis solicitudes». On or after the first day an
approved vacation is HR's to void from the expediente.

## Screens

| Path                                        | Who                            |
| ------------------------------------------- | ------------------------------ |
| `/mi/solicitudes`                           | the employee: list and balance |
| `/mi/solicitudes/nueva`                     | the employee: the form         |
| `/mi/equipo/aprobaciones`                   | the jefe: the inbox (W2-07)    |
| `/mi/equipo/aprobaciones/[id]`              | the jefe: weigh and decide     |
| `/app/solicitudes`, `/app/solicitudes/[id]` | HR                             |

Every list is newest first in keyset pages ([keyset.md](keyset.md)), never
OFFSET.

## Table (migration 0047)

`time_off_requests`, a company table under the same RLS as the rest. The app
role gets SELECT, INSERT and UPDATE, not DELETE: a request is cancelled, never
deleted. Checks keep the shape honest: dates in order, days in half steps,
a decided request has `decided_at`, a rejection has its reason, only a
vacation points to a vacation row, and `cancelled_at` matches the status.
0047 also adds `permiso` to `person_event_type`.

Indexes:

- `time_off_requests_inbox_idx (company_id, manager_id, status, created_at
DESC, id DESC)`: the inbox, one range scan per approver and no sort. HR's
  queue (`manager_id IS NULL`) uses it too.
- `time_off_requests_person_idx (company_id, person_id, created_at DESC, id
DESC)`: «Mis solicitudes» and the overlap check.

Measured on a local Postgres 16 (2026-11-04) with 20,000 requests (500 people
asking eight times a year for five years): table 2.9 MB, indexes 6.9 MB. A
manager's inbox page is an index-only scan of 4 buffers in 0.04 ms; HR's
queue 0.06 ms; HR's list of every request has no index of its own and reads
the table (360 buffers) in about 7 ms. That is small next to the 1 GB of Neon
Free, so the second index of [keyset.md](keyset.md) waits until it is needed.

## Neon Free

No cron, no counters, no new service. The balance is computed from
`vacation_records` when it is read, as in W2-05. Notifications reuse W2-08's
free email and web push.
