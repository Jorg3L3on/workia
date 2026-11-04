# Identity model

Who signs in to Workia, which `people` row they are, and how one person spans
subsidiaries. Workia 2.0 task P-00. This is the model the employee accounts
(W2-01), the person timeline (P-01), manager scope (W2-07) and transfers
between subsidiaries (W2-24) are built on. Those tasks implement it; this
document is what they follow. HR authentication does not change.

## Summary

- **Records are keyed by Workia ids.** A person is a `people` row, and that row
  belongs to exactly one company. Everything about a person points at
  `(company_id, person_id)`, never at a CURP, an email or an account.
- **Every active person has a valid CURP.** It is a required, validated field
  of the person, unique among the live people of a company. It is not a key.
- **Two kinds of sign-in.** HR users (`users`, Auth.js, company memberships)
  stay as they are. Employees get an employee account linked to one `people`
  row, with its own session.
- **A manager is an employee.** Their team is read live from
  `people.manager_id`; manager screens are a grant on their employee account.
- **One person in two subsidiaries is two rows, linked.** A transfer creates a
  row in the other company and a link between the two rows, by id. The CURP of
  both rows must match. Company row-level security stays as it is.
- **Company RLS does not separate employees from each other.** Per-person
  isolation is the job of the employee guard and of IDOR tests.

## Keys

| What                    | Key                                                                   | Notes                                                                                                               |
| ----------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| A person                | `people.id`, unique with `company_id` (`people_company_id_id_unique`) | One row per person per company. A row never moves to another company.                                               |
| Anything about a person | `(company_id, person_id)`, composite foreign key to `people`          | Contracts, periods, vacations, documents, `person_events` (P-01), accounts (W2-01), links (W2-24). No CURP columns. |
| An HR user              | `users.id`                                                            | Platform table. Business access through `company_memberships`.                                                      |
| An employee account     | `employee_accounts.id` (W2-01)                                        | Points at one `(company_id, person_id)`.                                                                            |

`people.company_id` plus the composite foreign keys (migration 0016) already
make the database refuse a record that points at a person of another company.
New tables in 2.0 follow the same pattern and are covered by
`src/lib/db/schema/tenant-coverage.test.ts`.

## CURP

The CURP identifies the person in the real world (IMSS, SAT, the CFDI
receptor). In Workia it is a validated attribute of the `people` row, not a
key:

- **Required on every active person.** A person whose status is `activa` and
  who is not borrado must have a CURP that passes `isValidCurp` (format, state
  code and check digit, `src/lib/people/identity.ts`). The one rule is
  `activePersonLacksCurp()`; `MissingCurpError` is what the domain throws.
- **Optional on bajas and borrados.** A baja captured before the rule may stay
  without one. It needs one again to be rehired: `rehirePerson` refuses a
  reingreso without a valid CURP.
- **Unique per company, among live people** (`people_company_curp_active_unique`,
  migration 0017). The same CURP may exist in two companies: that is a
  transfer (below), or a person who works for two subsidiaries.
- **Never a foreign key, never copied.** `person_events` has no CURP column;
  nothing joins on it. A CURP is corrected in one place, the person.
- **Normalized** to upper case without spaces before it is validated or stored.

Where the rule is enforced (P-00 acceptance: form, importer, MCP tools):

| Path                                 | Where                                                                                        | What the user sees                                                                               |
| ------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Person form (alta and edit)          | `personFormSchema` (`src/lib/people/schema.ts`), with the status the save keeps              | «La CURP es obligatoria para una persona activa» on the CURP field; the field is marked required |
| MCP `create_person`, `update_person` | The same `personFormSchema` (`parseForm` in `src/lib/mcp/tools/people-writes.ts`)            | `VALIDATION` with the issue on `curp`                                                            |
| MCP `set_person_status` (reingreso)  | `rehirePerson` (`src/lib/people/employment.ts`)                                              | `CONFLICT` with «Para reingresar a esta persona primero captura su CURP…»                        |
| Import of Personas                   | `classifyPersonRow` (`src/lib/import/person-rows.ts`), on the row merged with what is stored | Row error on the CURP column; a blank cell on an update keeps the stored CURP                    |
| Any other caller of the domain       | `createPerson` / `updatePerson` (`src/lib/people/index.ts`) call `assertActivePersonHasCurp` | `MissingCurpError`                                                                               |

There is no database `CHECK` for this yet. The rule depends on `status` and
`deleted_at`, it would refuse the test rows already in the database, and every
write path goes through the functions above. Once real people are loaded and
`npm run db:report-identity-duplicates` is clean, a `CHECK (status = 'baja' OR
deleted_at IS NOT NULL OR curp IS NOT NULL)` can be added as a second layer
with its own migration.

## Who signs in

### HR users (unchanged)

`users` with Auth.js (email and password, or Google), a role per company in
`company_memberships`, the active company in the JWT, `requireCompanyContext()`
as the guard. See [multiempresa.md](multiempresa.md). An HR user is not linked
to a `people` row, and 2.0 does not link them.

### Employees (W2-01)

An **employee account** is how a person signs in to see their own record.

- **One account, one person row.** `employee_accounts` has `company_id` and
  `person_id` with a composite foreign key to `people`. At most one
  non-disabled account per person: a unique index on `(company_id, person_id)`
  where the account is not disabled.
- **States:** `invited` → `active` → `disabled`. HR invites; the employee
  activates; a baja or a borrado disables. A disabled account is kept for the
  audit trail and never reactivated: a rehire gets a new invitation.
- **Not under company RLS for sign-in.** Sign-in finds the account before a
  company is known, the way Auth.js finds a `users` row. After sign-in every
  business read runs with the account's `company_id` as `app.company_id`,
  exactly like HR reads.
- **A separate session.** Its own cookie and its own guard,
  `requireEmployeeContext()`, returning `{ accountId, companyId, personId }`.
  Sessions are rows (`employee_sessions`, a hashed token and an expiry) so a
  baja can revoke them the same day; the Auth.js HR JWT is not reused. An HR
  user who is also an employee has two independent sessions.
- **Audit.** Every login, activation, code request and revocation is an
  `audit_events` row of the account's company. Actions an employee takes are
  audited with the account as the actor (W2-01 adds the actor column; HR
  actions keep `actor_user_id`).

### Email

- **`people.email` is a hint, not an identity.** HR captures it; it is where
  the invitation goes. It is not verified and not unique.
- **The account holds the verified email.** Verified by a one-time code sent
  to it, stored normalized (trimmed, lower case).
- **Unique among non-disabled accounts, across all companies.** Sign-in by
  email must resolve to one account. A unique index on the normalized email
  where the account is not disabled. Inviting an email already on a
  non-disabled account is refused, in any company.
- **Reuse.** Disabling an account frees its email, so a rehired person, or a
  person transferred to another subsidiary, can be invited with the same email.
- **Changing it** sends a code to the new address; the old one stays until the
  new one is verified.
- **Google sign-in** works only for an account whose verified email equals the
  Google account's verified email. Google never creates an account.
- **Codes** are short, single use, stored hashed, with an expiry and an attempt
  limit, rate limited per account and per IP. Email only: no SMS and no
  WhatsApp, because 2.0 adds no cost. Which free sender is still open (plan,
  section 11).

### People without email

HR issues a **one-time activation code** bound to one person row: shown once,
stored hashed, with an expiry. The employee enters it with their CURP, then
sets a password. From then on they sign in with **CURP and password**.

- The CURP is read from `people`, not copied into the account, so a correction
  of the CURP reaches the login.
- **One non-disabled account per CURP, group-wide.** An index cannot span the
  join to `people`, so the invite and activation transaction takes an advisory
  lock on the normalized CURP and refuses a second live account for it.
- Adding a verified email later turns the account into an email account.

### Revocation

A baja (`terminatePerson`) and a borrado (`softDeletePerson`) disable the
person's account and delete its sessions in the same transaction as the
change. W2-01's acceptance ("disabled the same day") is met by construction,
with no job to reconcile.

## Managers (W2-07)

- A manager signs in with **their own employee account**. There is no manager
  account and no company-membership role for it.
- **The team is read live**: active, live people of the same company whose
  `manager_id` is the manager's `person_id`. Never `employment_periods.manager_id`,
  which is a snapshot taken when a period closes. Changing a person's jefe
  moves them to the new team on the next request.
- **Manager screens are a grant on the account**, given by HR, with the scope
  (direct reports, or indirect too when HR enables it). Indirect reports are a
  recursive query over `people.manager_id`, not a stored tree.
- **Delegation** is a grant from one account to another with an end date.

## One person across subsidiaries (W2-24)

A person normally works for one subsidiary. The rare transfer:

1. Closes the employment period in the old company and opens one in the new
   company, which gets its own `people` row. The rows never merge and never
   move.
2. Records a **link** between the two rows, by id (`person_links`: the two
   `(company_id, person_id)` pairs with composite foreign keys, who and when;
   one row per company so each side stays under its own RLS).
   The link is refused when the CURPs of the two rows differ. Both rows are
   active at the moment of the transfer, so both have a valid CURP.
3. Writes an `employment` event in each company's timeline (P-01).

The **group person** is the set of rows connected by links. There is no global
person table and no global CURP key. Group seniority is computed from the
employment periods of the linked rows.

**Reads across companies keep RLS on.** A group read (the group timeline, group
dashboards) runs once per company the reader may see, each with its own
`app.company_id`, and merges the results in the app. It never disables RLS and
never runs as the table owner. Who may read the group is a group admin grant
(W2-24); until then cross-company reads need a membership in each company, as
today.

**The employee's account** stays on the row they signed in with. A transfer
disables it and invites the new row (the same email is free again), and the
employee's own history follows the links back.

## Per-person isolation

Company RLS separates companies, not employees. Within one company:

- The employee guard is the only source of `personId`. Employee routes never
  take a person id from the URL, the form or the query (`/mi/…` is always "me").
- A record reached by its own id (a receipt, a document, a request) is loaded
  with `person_id = guard.personId` in the query; anything else is a 404.
- A manager's read of a team member checks `manager_id` (or the grant's scope)
  in the same query, on every request.
- HR screens and MCP tools keep `requireCompanyContext()`.
- **IDOR tests** add two employees of the same company: each test proves one
  cannot read or change the other's data, next to the existing company A /
  company B tests in `src/test/idor` and `docs/idor-matrix.md`.

## What the next tasks take from this

- **W2-01 Employee accounts:** `employee_accounts`, `employee_sessions`, the
  codes, the guard, the email and CURP rules above, revocation inside
  `terminatePerson` and `softDeletePerson`, the account as an audit actor.
- **P-01 Timeline table:** `person_events` keyed by `(company_id, person_id)`,
  no CURP, no account id as the key; the actor stays in `audit_events`. Built:
  see [timeline.md](timeline.md).
- **W2-07 Manager scope:** the grant, the live team from `people.manager_id`,
  delegation with an end date.
- **W2-24 Transfers:** `person_links`, the CURP match, per-company reads merged
  in the app, the group admin grant. Built: see [transfers.md](transfers.md).

All of it fits Neon Free: a few hundred accounts, sessions and codes deleted by
expiry in batches, no new extension, no new service.
