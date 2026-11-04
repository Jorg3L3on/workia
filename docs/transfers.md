# Transfers between subsidiaries

The rare move of a person to another company of the group, without
re-capture and keeping their seniority. Workia 2.0 task W2-24, built on the
[identity model](identity-model.md) and the [person timeline](timeline.md).
Migration `0046_person_links`, code in `src/lib/transfers`.

## What a transfer does

`transferPerson(companyId, personId, input, actorUserId)` runs one
transaction. From the person's row in company A to company B:

1. **Checks.** The row is live and `activa` with a valid CURP and an open
   period; B is another active company; the first day in B (`fechaTraslado`)
   is after the ingreso in A. Área, puesto, sucursal and jefe, when given, are
   live records of B.
2. **Finds the row in B.** A live row of B with the same CURP (or the
   `toPersonId` the caller names). Its CURP must match A's (`curpsMatch`):
   otherwise the transfer is refused with «La CURP de los dos expedientes no
   coincide». If that row is `activa`, or already has an open period, the
   person already works in B and the transfer is refused.
3. **Opens the period in B.** On the row it found (reopened: status `activa`,
   new ingreso), or on a new row with A's personal data and beneficiaries
   copied: names, contact, CURP, RFC, NSS, birth, address, marital status,
   INE. Company dimensions (área, puesto, sucursal, jefe) come from the form,
   never from A. RFC or NSS already on another live row of B refuses a new
   row. The period has `reconoce_antiguedad` and the **group seniority** (A's
   `fecha_antiguedad`) as its recognized date, so the constancia, vacations
   and every seniority read follow without new code.
4. **Closes the period in A** the day before, through `recordTermination` with
   the transfer option: tipo de baja **`traslado`** (new enum value), no
   motivo and no recontratable. As in any baja, the vigente contract ends, the
   employee account is disabled with its sessions, and a baja event and audit
   event are written.
5. **Links both rows** in `person_links` and writes an `employment` event of
   kind `transfer` in each company (`employmentTransferEvent`), next to the
   alta of B's period and the baja of A's.
6. **After the commit**, if the person had an employee account with an email
   and the actor may manage accounts in B, B's row is invited to the same
   email, which the baja just freed.

Rows never merge and never move. A person transferred A → B → A reopens their
first row in A, so each company holds at most one live row per CURP.

## `person_links`

One transfer is two rows, one in each company, sharing `transfer_id`:

| Column                                  | What                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------- |
| `company_id`, `person_id`               | this side's row; composite FK to `people`                              |
| `linked_company_id`, `linked_person_id` | the other side's row; composite FK to `people`                         |
| `transfer_id`                           | the same on both sides; also the timeline dedupe key                   |
| `direction`                             | `out` on the row the person left, `in` on the row they arrived at      |
| `transfer_date`                         | first day in the new company                                           |
| `employment_period_id`                  | the period this side closed (`out`) or opened (`in`); FK to its period |
| `created_by`, `created_at`              | who and when                                                           |

Each company sees only its own side under its usual
`person_links_company_isolation` policy and learns the other side's ids,
never its data. No CURP column: the flow compares the CURPs of the two rows.
The app may read and insert, never update or delete (the grants revoke both);
a hard-deleted person takes its links with it.

## Who may do what

- **Transfer:** the new `people:transfer` permission (admin and super_admin)
  in the company the person leaves **and** in the company they join, through
  the actor's own membership. `listTransferTargets(session)` lists the
  companies offered. Writes never use the group admin grant.
- **Read the group:** `loadGroupReader(userId)` returns the companies whose
  people the user may read: those where their role has `people:read`, and
  every active company with the **group admin grant** (`users.is_group_admin`,
  given by a platform admin at `/admin/grupo`).
- **Reads keep RLS on.** `getGroupPerson` walks the links from a row the
  reader can read: each row is read with `tdb(companyId)` of its own company.
  A company the reader cannot read stays a name: its row is neither read nor
  followed. `listGroupTimeline` reads each visible row's `person_events` with
  the same keyset cursor and merges them newest first, so pages never skip or
  repeat. Nothing runs as the table owner. A transaction that writes to both
  companies switches `app.company_id` with `actInCompany(tx, companyId)`.

## Screens

- Expediente ⋯ menu → **Trasladar a otra empresa**
  (`/app/personas/[id]/traslado`): pick the company, then the first day there
  and its sucursal, área and puesto. Only for an active person and when a
  target exists.
- Expediente: a notice «Se trasladó a…» / «Llegó por traslado desde…» and the
  menu item **Historial del grupo** (`/app/personas/[id]/grupo`): the person's
  rows across the group, «Abrir en <empresa>» for companies the user belongs
  to, and the merged timeline.
- Platform console → **Administración del grupo** (`/admin/grupo`).

## Reports and the importer

- The turnover report of A counts the transfer as a baja of tipo «Traslado a
  otra empresa del grupo», with no motivo; the tipo filter can leave it out.
- The importer reads the «traslado» label so an exported file imports back
  unchanged, and refuses a row that would write or change a traslado.

## Production

Apply `0046_person_links` and run `npm run db:sync-permissions` so roles get
`people:transfer`. No new service, no new extension and no job; a transfer is
a few rows, well inside the Neon Free budget.
