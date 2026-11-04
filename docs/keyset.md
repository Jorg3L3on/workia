# Keyset pagination

How the lists employees and managers open all day page through rows. Workia
2.0 task P-04. Helper `src/lib/db/keyset.ts`, today view
`src/lib/timeline/today.ts`, migration `0036_today_view_indexes`.

## The rule

New queries never page with `OFFSET`. `OFFSET 5000` reads and throws away
5,000 rows on every request, and on Neon those reads are compute. A keyset page
starts right after the last row of the previous one, so page 500 costs what
page 1 costs, and a row added or removed meanwhile does not shift the pages.

`npm run lint` enforces it: `.offset(...)` and `OFFSET <n>` or `OFFSET ${...}`
in SQL strings and templates are errors (`noOffsetRule` in
`eslint.config.mjs`). The lists written before P-04 that still use OFFSET are
listed in `LEGACY_OFFSET_FILES` (people, audit, resguardo and import jobs).
They move to the helper later; take a file off the list when it does, and never
add one.

## The helper

```ts
import { clampPageSize, defineKeyset } from "@/lib/db/keyset";

// Keys in ORDER BY order. Every key is NOT NULL and the last one is unique.
const inbox = defineKeyset([
  { column: requests.createdAt, type: "timestamptz", direction: "desc" },
  { column: requests.id, type: "uuid", direction: "desc" },
]);

const limit = clampPageSize(options.limit, 50, 200);
const rows = await tdb(companyId)
  .select({ id: requests.id /* ... */, cursor: inbox.cursor })
  .from(requests)
  .where(withTenant(requests, companyId, /* filters */ inbox.after(cursor)))
  .orderBy(...inbox.orderBy)
  .limit(limit + 1);

return inbox.page(rows, limit); // { items, next }
```

- `cursor` is the select field the next cursor is made from; `page` drops it
  from the rows. `next` is an opaque string (base64url JSON), null on the last
  page. Pass it back as it is.
- `after(cursor)` is the WHERE condition for the rows after the cursor, or
  undefined for no cursor or one it cannot read (an old link, a tampered value),
  so the list starts over instead of failing.
- Keys that all go the same direction compile to a row comparison,
  `(created_at, id) < ($1::timestamptz, $2::uuid)`, which a btree on those
  columns uses as the start of its scan. Mixed directions compile to an OR chain
  with a bound on the first key.
- Key values travel as Postgres renders them in JSON and are cast back with the
  key's type, so a timestamp keeps its microseconds. A JS `Date` would cut them
  to milliseconds and skip or repeat rows.
- The index that serves a list has the list's filter columns first, then the
  keys in the same order and direction.

`listPersonEvents` (`src/lib/timeline`) uses it, so its cursor is now this
opaque string (`cursor`, not `before`).

## Today view

`listTodayPage(companyId, scope, { day, cursor?, limit? })` returns the active
people of a site, an area or a manager's direct reports (`{ siteId }`,
`{ areaId }` or `{ managerId }`) in name order, each with the day's attendance
payload (null when nobody punched) and the day's incidencias. `day` is the
local date in America/Mexico_City, the date the attendance dedupe key holds.

It starts from the roster in `people`, not from the punches, so absent people
are in the list. One query per page, and no index of its own:

- the roster through `people_site_id_idx`, `people_area_id_idx` or
  `people_manager_id_idx`, sorted in memory (one site is about a hundred rows);
- each person's attendance with one probe of `person_events_dedupe_unique`
  on `(person_id, 'attendance:<day>')`;
- each person's incidencias of the day with a short range of
  `person_events_person_time_idx`.

0031's `person_events_site_day_idx` (keyed by `payload->>'site_id'`) served a
punch-driven version of this view. It could not list who did not punch, and it
grew with every attendance row on the 1 GB Neon Free plan, so 0036 drops it.

Counts for the day (on shift, absent, late) come from the P-02 aggregates in
W2-15 and W2-17, not from this list. The plan check is in
`src/test/idor/today.db.test.ts` (a site of 100 people with five years of
attendance) and the timings in [timeline.md](timeline.md).

## Approvals inbox

W2-06 created the requests table, `time_off_requests` (migration 0047), with
its index in the same migration:

- `time_off_requests_inbox_idx (company_id, manager_id, status, created_at
DESC, id DESC)`, where `manager_id` is the approver stored on the request
  when it is created (W2-07 moves a person to the new manager on the next
  request).
- The inbox query filters `company_id`, `manager_id` and `status` by equality
  and pages with the keyset above, `created_at DESC, id DESC`, so a page is one
  index range scan with no sort. The inbox hands each source the last item's
  UTC sort key; the source turns it back into a cursor with `keysetCursor()`.
- HR's list of every request has no second index: measured at 20,000 rows
  (500 people, five years) a page reads the whole table in about 7 ms
  ([solicitudes.md](solicitudes.md)). Add `(company_id, status, created_at
DESC, id DESC)` only if that grows into a problem.
