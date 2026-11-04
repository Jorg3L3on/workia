# Managers

How a jefe sees their team and what waits for their approval in the employee
app (Workia 2.0 W2-07). It implements [identity-model.md](identity-model.md) →
«Managers».

## The model

- A manager signs in with **their own employee account** ([employee-accounts.md](employee-accounts.md)).
  There is no manager account and no company-membership role.
- **The grant** is HR's: expediente → «Cuenta de empleado» → «Rol de jefe»
  (permission `employee_accounts:manage`, no new permission). It lives on the
  account, one live grant per account, with one option: include indirect
  reports.
- **The team is read live** on every request: active, live people of the
  same company whose `people.manager_id` is the manager's person. With indirect
  reports on, a recursive query follows `manager_id` down to 10 levels (it
  also stops a cycle). Nothing is stored, so changing a person's jefe in the
  expediente moves them to the new team on the next request.
  `employment_periods.manager_id` is a snapshot taken when a period closes and
  is never used for this.
- **Delegation**: the manager names a backup from `/mi/equipo` (their direct
  report or another manager with an account), from a start date to an end
  date, both Mexico dates and both included. While it is live the backup sees
  the manager's team and decides the manager's approvals. It needs the
  manager's grant to be live, it does not chain, and it ends by itself after
  the end date. The manager or HR can end it early.
- A baja, a borrado or HR's «Desactivar cuenta» ends the account's grant and
  every delegation from or to it, in the same transaction
  (`revokeEmployeeAccess` → `endManagerAccess`). «Quitar rol de jefe» ends
  the grant and the delegations the manager gave.

## Tables (migration 0039)

| Table                 | What it holds                                                                       |
| --------------------- | ----------------------------------------------------------------------------------- |
| `manager_grants`      | `(company_id, account_id)`, `include_indirect`, who granted, `revoked_at`           |
| `manager_delegations` | manager account → delegate account, `starts_on`, `ends_on`, who created or ended it |

Both are company tables under the same RLS as the rest. Revoked rows stay for
the audit trail. Every change is an audit event (`manager_grant`,
`manager_delegation`); a manager's own delegation records the employee as the
actor (source `employee`).

## Code

`src/lib/managers`:

- `getManagerAccess(context)`: the scopes this signed-in account acts for
  today (its own grant, then live delegations), or null. Every manager screen
  starts here and is a 404 without it.
- `teamCondition(access)`, `isInTeam`, `listTeam`, `getTeamMember`: the team
  reads. Any person id from a URL goes through them, so a person outside the
  team, in this company or another, is a 404.
- `approverPersonIds(access)`, `canDecideFor(access, approverId)`: whose
  approvals the account decides. Indirect scope widens what a manager sees,
  not what they approve.
- `currentApprover(companyId, personId)`: the person's live jefe when that
  jefe has a live grant, else null (the request goes to HR).
- `inbox.ts`: the approvals inbox (`/mi/equipo/aprobaciones`). Each kind of
  request is an `InboxSource`; the inbox merges their pages newest first with
  one opaque cursor. There are no sources yet, so the inbox is empty until
  W2-06.

The team list pages with a keyset on the name and the id (no `OFFSET`,
[keyset.md](keyset.md)). It uses its own small cursor because the shared
helper `src/lib/db/keyset.ts` arrives with P-04; switch to it once both are in
`sandbox`.

## For W2-06 (requests and approvals)

- When a request is created, store `approver_person_id =
currentApprover(companyId, requesterId)`. Null means HR decides. A later
  change of jefe does not move a pending request.
- Register a source in `INBOX_SOURCES` that lists pending requests where
  `approver_person_id = ANY(approverIds)`, keyset on
  `(created_at DESC, id DESC)` through the index docs/keyset.md fixes, and
  returns `sortKey` as
  `to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`.
- Before a decision, check `canDecideFor(access, request.approverPersonId)`.
  A delegate's decision is audited with the delegate's account as the actor.
- The vacation timeline events go through `vacationRequestEvent` and
  `appendPersonEvents` (W2-13) in the request's transaction.

## Neon Free

Two small tables with partial indexes on live rows. The team read uses
`people_manager_id_idx`; the access check is two index lookups per request.
No cron, no counters, no new service.
