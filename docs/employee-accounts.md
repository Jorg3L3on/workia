# Employee accounts

How a person signs in to the employee app at `/mi` (Workia 2.0 W2-01). It
implements [identity-model.md](identity-model.md) → «Employees». HR sign-in
(`/login`, Auth.js) does not change.

## Tables (migration 0030)

| Table               | What it holds                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| `employee_accounts` | One row per account: `(company_id, person_id)`, `invited` → `active` → `disabled`, verified email    |
| `employee_sessions` | One row per signed-in device: HMAC of the cookie token, 30-day expiry                                |
| `employee_codes`    | One-time codes: `login` (6 digits by email, 10 min) and `activation` (12 characters from HR, 7 days) |

- All three are company tables under the same RLS as the rest.
- Unique indexes: one live (not disabled) account per person; one live
  account per normalized email, across every company.
- One live account per CURP across the group: invitations take an advisory
  lock on the CURP and refuse a second one.
- `audit_events.actor_employee_account_id` records the employee as the actor
  of what they do (source `employee`). HR actions keep `actor_user_id`.
- `employee_credential_company(kind, lookup)` is a `SECURITY DEFINER`
  function, like `mcp_credential_company` (0009). It only says which company
  holds an email, a CURP or a session token hash. Every read after that runs
  under that company's RLS.
- Codes and session tokens are stored only as an HMAC keyed by `AUTH_SECRET`.
  Rotating `AUTH_SECRET` signs every employee out and voids pending codes.

## Flows

| Who                | How they get in                                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Has an email       | HR invites (expediente → «Cuenta de empleado»). The employee opens `/mi/entrar`, gets a code by email, types it.                                    |
| Has a Google email | Same invitation. «Entrar con Google» works only when Google's verified email equals the account's email.                                            |
| Has no email       | HR generates an activation code (shown once). The employee types it with their CURP at `/mi/activar` and sets a password. Later: CURP and password. |

- The first successful code (or Google) activates the invitation and
  verifies the email.
- A new HR code on an active account resets the password and closes its
  other sessions.
- Wrong codes count. After 5 tries a code stops working.
- Rate limits live in `rate_limits` (no Redis), per 15 minutes:
  - code requests: 10 per IP and 3 per account;
  - code checks: 30 per IP;
  - CURP sign-in and activation: 20 per IP and 5 per CURP.
- The sign-in form answers the same for an email with or without an account.

## Revocation

These disable the account and delete its sessions and codes in the same
transaction:

- a baja (`recordTermination`, so the dialog, the MCP tool and the importer);
- a borrado (`softDeletePerson`);
- an import undo that reverts an alta;
- HR's «Desactivar cuenta».

The guard also refuses a session whose person is not `activa` or is borrado,
as a second layer. A disabled account never comes back, and its email is free
again. A rehire is invited again.

## The guard

`requireEmployeeContext()` (`src/lib/employee-accounts/session.ts`) returns
`{ accountId, companyId, personId }` from the `workia.employee-session` cookie
(`__Host-` on HTTPS). The cookie is separate from Auth.js, so an HR user who
is also an employee has two independent sessions.

`/mi` routes never take a person id from the request. The proxy sends `/mi/*`
without the cookie to `/mi/entrar`; the guard checks the session row.

## Phone install

`/mi` has its own manifest (`/mi/manifest.webmanifest`, scope `/mi`) and a
service worker (`/mi/sw.js`) that caches nothing. The home screen offers the
browser's install prompt on Android and the «Agregar a inicio» steps on
iPhone.

## Configuration

| Variable                               | Needed for                                                                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `EMAIL_SMTP_URL`, `EMAIL_FROM`         | Sending codes and invitations in production. Any SMTP server: a provider's free tier or the company's own server.                |
| `EMAIL_OUTBOX_DIR`                     | Development and e2e without SMTP: each email is a JSON file there (default `.outbox/`). Production without SMTP refuses to send. |
| `APP_PUBLIC_URL`                       | Links in emails and the Google redirect. Without it, the request's host.                                                         |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Google sign-in, the same client as HR. Add `<origin>/api/mi/google/callback` as an authorized redirect URI in Google Cloud.      |

Without SMTP in production, invitations are recorded but no email leaves.
HR sees that and can hand out an activation code instead.

Release: run `npm run db:sync-permissions` after the migration. It adds
`employee_accounts:manage`, which only `admin` and `super_admin` get.

## Neon Free

- Sessions and codes are small rows. Expired ones are deleted now and then
  when someone signs in, per company.
- There is no cron, no new extension and no new service.
