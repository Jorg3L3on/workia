# Mi expediente

What an employee sees of their own record in the employee app, and how they
ask HR to correct it (Workia 2.0 W2-02). It builds on
[employee-accounts.md](employee-accounts.md): every read and write takes the
person from `requireEmployeeContext()`, never from the URL or a form.

## The view (`/mi/expediente`)

Read only. Four sections, in this order:

| Section              | Fields                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Datos personales     | nombre(s), apellidos, fecha de nacimiento, CURP, RFC, NSS, sexo, estado civil, lugar de nacimiento, nacionalidad |
| Contacto y domicilio | correo personal, teléfono, domicilio, correo de acceso a la app                                                  |
| Trabajo              | empresa, puesto, área, sucursal, jefe directo, horario, fecha de ingreso, antigüedad                             |
| Contrato             | tipo y estado, inicio, fin of the vigente contract (only when there is one)                                      |

- Every field and the Postgres columns it is built from are listed once in
  `EXPEDIENTE_FIELDS` (`src/lib/employee/expediente-model.ts`). A unit test
  checks each source against the Drizzle schema, so a field cannot show
  something that is not a column.
- `getEmployeeExpediente(context)` (`src/lib/employee/expediente.ts`) reads it
  in three queries: the person with its catalog names, manager and schedule;
  the employment periods; the vigente contract.
- Fecha de ingreso and antigüedad come from the current employment period
  (`summarizePeriods`, the same seniority date as the HR expediente and the
  constancia), or `people.fecha_ingreso` before any period exists. Antigüedad
  is not shown on baja.
- The contract shows no amounts: no salario, forma or periodicidad de pago.
  The contract text and the constancias are W2-11.
- An empty field reads «Sin capturar», so the employee can ask for it.

## Corrections

The employee never edits a field. «Corregir» (`/mi/expediente/corregir?campo=…`)
asks what the field should say, with an optional comment, and creates a
`profile_corrections` row (migration 0038):

- `current_value` is what the expediente showed at that moment, computed on
  the server, and `proposed_value` is the employee's text. HR sees both.
- Only fields with a place in the person form can be corrected. Empresa,
  antigüedad, the access email and the contract cannot.
- One pending request per field and person (a partial unique index). A value
  equal to today's (ignoring case and spaces) is refused.
- The employee can cancel a pending request. «Mis correcciones» lists their
  last 20 with the status and, when rejected, HR's reason.

Statuses: `pendiente` → `aplicada` or `rechazada` (HR), or `cancelada`
(employee). `decided_at` is set when it leaves `pendiente`; a rejection needs a
reason.

## HR inbox (`/app/correcciones`)

- Gated by `people:update`, the permission that edits the record being
  corrected. No new permission, so nothing to sync.
- Pending requests of the active company, oldest first, 25 per page, with
  keyset pagination over `(created_at, id)` (`src/lib/db/keyset.ts`, see
  [keyset.md](keyset.md), from P-04) served by the partial index
  `profile_corrections_inbox_idx`. People borrados drop out.
- Each request shows the person, the field, «Antes», «Propuesto» and the
  comment. «Editar expediente» opens the person form at that field
  (`personEditHref`). HR saves the change there, which keeps its own
  validation and audit, then «Marcar como corregido». «Rechazar» needs a
  reason, which the employee reads.
- The app does not copy the proposed value into the record by itself: a
  correction often needs a document check (CURP, RFC, NSS) first.

## Audit

`audit_events` with `resource_type = 'profile_correction'`:

| Action    | Actor                                                         | Payload                                     |
| --------- | ------------------------------------------------------------- | ------------------------------------------- |
| `create`  | the employee (`actor_employee_account_id`, source `employee`) | before and after of the field               |
| `cancel`  | the employee                                                  | summary                                     |
| `approve` | the HR user («marcó aplicada»)                                | before and after                            |
| `reject`  | the HR user                                                   | before, after and the reason in the summary |

## Size

One short row per request. A company of 500 people asking a few corrections a
year adds kilobytes, well inside Neon Free's 1 GB.
