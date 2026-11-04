# Asistencia: ingestion of punches

Workia 2.0 task W2-12. Every punch, from a checador's CSV export, a device
push or the employee app, lands in the person's attendance row for that day in
`person_events` (one row per person per day, P-01). Migration
`0044_attendance_ingestion`, code in `src/lib/attendance`, HR screen
`/app/asistencia`, employee screen `/mi/checar`.

## Sources

| Source       | How it arrives                                                                   | Who                                    |
| ------------ | -------------------------------------------------------------------------------- | -------------------------------------- |
| CSV export   | HR uploads the file a checador exported, on `/app/asistencia`                    | `attendance:manage`                    |
| Device push  | `POST /api/asistencia/checadas` with `Authorization: Bearer <device token>`      | the checador's token (no session)      |
| App check-in | the employee scans the site's QR with the phone camera, which opens `/mi/checar` | the signed-in employee (W2-01 session) |
| Late match   | HR assigns a number to a person; the punches waiting on it are ingested          | `attendance:manage`                    |

The checador models in use are not decided, so nothing assumes one. Each
checador (`attendance_devices`) stores how its export reads: separator, header
rows, which column holds the person's number, the date and time (one column or
two), the date order, and optionally an entrada/salida column with the values
that mean each. Columns are named by header or by number. Three presets are
starting points HR adjusts to the real file. Times without an offset are read
in `America/Mexico_City`, the zone of the attendance day key and the today
view.

Scheduled pulls from a device API are not built: they need a known device
API, which waits on the checador decision. When one is chosen, a pull is a
cron route that calls `ingestPunches` with the same `{ kind: "batch", source:
"device" }` target as the push route, plus a cron entry Jorge adds.

## Idempotency and dedupe

- One attendance row per person per local day (`attendance:<YYYY-MM-DD>`).
  Writing goes through W2-13's `writeAttendanceDays`: the app role has no
  `UPDATE` on `person_events`, so a day that gains punches is a delete of its
  row and an insert of the merged one, in one transaction.
- A punch is identified by its instant (to the second) and its device. A
  punch already in the day is skipped and counted as a duplicate, so the same
  export uploaded twice, or a push retried, writes nothing.
- Ingestions of one company run one at a time
  (`pg_advisory_xact_lock(hashtextextended('attendance:<company>'))`), so two
  uploads of the same day never race on its row.
- Without an entrada/salida column, a new punch takes the turn of its place in
  the day: entrada, salida, entrada… The kind stored first wins on a re-upload.
  The incidencias engine (W2-14) reads first entry and last exit, not turns.
- Punches more than 10 minutes in the future are refused as a wrong clock.

## What HR reviews

`attendance_unmatched` keeps, with the raw row as it came (at most 16 cells of
60 characters):

- **Número sin persona**: a number no person has. HR assigns it to a person
  (`attendance_badges`, one number per person per company, leading zeros
  ignored) and every open punch with that number is ingested in the same
  transaction; or dismisses the row.
- **No se pudo leer**: a line whose number, date or time does not read with
  the checador's format, or a punch from the future. HR dismisses it after
  fixing the format or the clock.

The same punch or the same unreadable line reported twice stays one row
(partial unique indexes). Duplicates are counted, not listed: they are punches
already stored, and listing them would grow the table with every retry.

`attendance_batches` keeps the counts of each upload (rows, new, already
there, without person, with error) and one row per device per day for pushes,
so a device pushing every minute is one row a day.

## Device push

```http
POST /api/asistencia/checadas
Authorization: Bearer wkc_…
Content-Type: application/json

{ "punches": [ { "badge": "123", "at": "2026-11-03 08:12:00", "kind": "in" } ] }
```

- `at`: ISO instant with offset, or local time `YYYY-MM-DD HH:mm[:ss]`.
  `kind` is optional. 1 to 1,000 punches, body up to 256 KB.
- Answer: `{ received, added, duplicates, unmatched, invalid }`. 401 for an
  unknown or revoked token, 400 for a body that is not a list of punches, 429
  past 120 requests a minute per IP or 60 per device.
- HR creates the token on the checador's card; it is shown once and stored as
  its SHA-256. A new token, or deactivating the checador, revokes the old one.

## App check-in

HR sets, per site, its position (latitude and longitude), a radius (25 to
2,000 m, 150 by default) and the QR mode:

- **En pantalla**: `/app/asistencia/qr/<site>` on a screen at the site (an HR
  session with `attendance:manage`) shows a code that changes every minute. A
  code works for three minutes, enough to scan and allow the location.
- **Impreso**: the same page shows a code to print. It works until HR presses
  «Invalidar códigos anteriores», which rotates the site's secret.

The code is the URL `/mi/checar?s=<site>&w=<minute>&m=<HMAC>`, signed with the
site's secret. The employee presses Entrada or Salida; the phone sends its
location. The punch counts only when the code is genuine and current, the
site has check-in on, the fix is at most 150 m accurate, and the phone is
inside the radius. Two taps of the same button within two minutes are one
punch. The person comes from the employee session, never from the request.

Privacy: the coordinates decide and are dropped. The stored punch is the
instant, the kind, `app` as device, and the site. The check-in also refuses
while the person has a privacy notice version pending (W2-09
`pendingPrivacyNotice`). The privacy notice should say that the app reads the
location at the moment of checking in, to confirm presence at the site, and
does not keep it (pendiente de revisión legal).

## Storage on Neon Free

Punches add no row beyond the day's attendance row (about 160 bytes with two
punches, docs/timeline.md). The new tables grow with HR actions, uploads
(one row each), device-days and unplaced punches (at most 1,000 stored per
upload or push).

## Permissions

`attendance:read` (see the screen) and `attendance:manage` (everything that
writes) go to `super_admin` and `admin`. Run `npm run db:sync-permissions`
after 0044 reaches an environment. Every HR change leaves an audit event
(`attendance_device`, `attendance_import`, `attendance_badge`,
`attendance_checkin`); punches go to the timeline, not to audit.
