/**
 * The person timeline (Workia 2.0 P-01). Company B cannot write events for
 * company A's person nor read A's timeline. Also covers dedupe, keyset pages
 * and the retention job. Titles are the surface ids in docs/idor-matrix.md.
 */
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import type { DbExecutor } from "@/lib/db";
import { CompanyReferenceError } from "@/lib/db/errors";
import { personEvents } from "@/lib/db/schema";
import {
  appendPersonEvents,
  attendanceDedupeKey,
  deleteExpiredPersonEvents,
  listPersonEvents,
  sourceDedupeKey,
  type PersonEventInput,
} from "@/lib/timeline";

import { ownerDb, seedTenant, type Tenant } from "./fixtures";

let a: Tenant;
let b: Tenant;

const rowsOf = (companyId: string) =>
  ownerDb
    .select()
    .from(personEvents)
    .where(eq(personEvents.companyId, companyId));

const attendance = (personId: string, day: string): PersonEventInput => ({
  personId,
  type: "attendance",
  occurredAt: new Date(`${day}T14:00:00Z`),
  source: "checador",
  dedupeKey: attendanceDedupeKey(day),
  payload: { first_in: "08:00", last_out: "17:00", punches: 2 },
});

beforeAll(async () => {
  a = await seedTenant("TLA");
  b = await seedTenant("TLB");
  await appendPersonEvents(a.companyId, [
    attendance(a.person.id, "2026-11-02"),
    attendance(a.person.id, "2026-11-03"),
    {
      personId: a.person.id,
      type: "document",
      occurredAt: new Date("2026-10-28T18:00:00Z"),
      source: "app",
      dedupeKey: sourceDedupeKey("document", "app", "doc-1"),
      payload: { kind: "comprobante_domicilio", status: "accepted" },
    },
  ]);
});

describe("lib:timeline/appendPersonEvents", () => {
  it("refuses company B writing an event for company A's person", async () => {
    const before = await rowsOf(a.companyId);

    await expect(
      appendPersonEvents(b.companyId, [attendance(a.person.id, "2026-11-04")]),
    ).rejects.toBeInstanceOf(CompanyReferenceError);
    expect(await rowsOf(a.companyId)).toEqual(before);
    expect(await rowsOf(b.companyId)).toEqual([]);
  });

  it("writes each dedupe key once, so re-running an ingestion adds nothing", async () => {
    expect(
      await appendPersonEvents(a.companyId, [
        attendance(a.person.id, "2026-11-03"),
        attendance(a.person.id, "2026-11-04"),
      ]),
    ).toBe(1);
    expect(
      await appendPersonEvents(a.companyId, [
        attendance(a.person.id, "2026-11-04"),
      ]),
    ).toBe(0);
  });

  it("inserts in batches larger than one statement", async () => {
    const days = Array.from({ length: 1_200 }, (_, index) => {
      const day = new Date(Date.UTC(2020, 0, 1 + index));
      return attendance(b.person.id, day.toISOString().slice(0, 10));
    });

    expect(await appendPersonEvents(b.companyId, days)).toBe(1_200);
  });
});

describe("lib:timeline/listPersonEvents", () => {
  it("returns nothing of company A's person to company B", async () => {
    expect(await listPersonEvents(b.companyId, a.person.id)).toEqual({
      events: [],
      next: null,
    });
  });

  it("returns one person newest first, in keyset pages that never repeat", async () => {
    const first = await listPersonEvents(a.companyId, a.person.id, {
      limit: 2,
    });

    expect(first.events.map((event) => event.type)).toEqual([
      "attendance",
      "attendance",
    ]);
    expect(first.events[0].occurredAt.toISOString()).toBe(
      "2026-11-04T14:00:00.000Z",
    );
    expect(first.next).not.toBeNull();

    const second = await listPersonEvents(a.companyId, a.person.id, {
      limit: 2,
      cursor: first.next,
    });

    expect(second.events.map((event) => event.type)).toEqual([
      "attendance",
      "document",
    ]);
    expect(second.next).toBeNull();
  });

  it("pages through microsecond timestamps and ties without skipping a row", async () => {
    // Backfilled rows can carry microseconds that a JS Date cannot hold.
    await ownerDb.$client.query(
      `INSERT INTO person_events (company_id, person_id, type, occurred_at, source)
       SELECT $1, $2, 'employment', timestamptz '2020-01-01 10:00:00.000001+00' + (i % 2) * interval '1 microsecond', 'backfill'
       FROM generate_series(1, 5) i`,
      [b.companyId, b.person.id],
    );

    const seen: string[] = [];
    let cursor: string | null = null;

    do {
      const page: Awaited<ReturnType<typeof listPersonEvents>> =
        await listPersonEvents(b.companyId, b.person.id, {
          types: ["employment"],
          cursor,
          limit: 2,
        });
      seen.push(...page.events.map((event) => event.id));
      cursor = page.next;
    } while (cursor);

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);

    await ownerDb.$client.query(
      "DELETE FROM person_events WHERE company_id = $1 AND source = 'backfill'",
      [b.companyId],
    );
  });

  it("filters by type", async () => {
    const page = await listPersonEvents(a.companyId, a.person.id, {
      types: ["document"],
    });

    expect(page.events).toHaveLength(1);
    expect(page.events[0].payload).toEqual({
      kind: "comprobante_domicilio",
      status: "accepted",
    });
  });

  it("returns nothing for an id that is not a uuid", async () => {
    expect((await listPersonEvents(a.companyId, "x")).events).toEqual([]);
  });
});

describe("retention job", () => {
  it("deletes attendance older than its retention, person by person, and keeps the rest", async () => {
    const deleted = await deleteExpiredPersonEvents({
      now: new Date("2026-01-01T00:00:00Z"),
      retention: {
        attendance: 5,
        incidencia: 5,
        vacation: null,
        receipt: null,
        document: null,
        employment: null,
      },
      peopleBatch: 1,
      executor: ownerDb as unknown as DbExecutor,
    });

    // Company B's 2020 rows are older than 2021-01-01: 366 days of 2020.
    expect(deleted.attendance).toBe(366);
    expect(deleted.document).toBe(0);
    expect(await rowsOf(b.companyId)).toHaveLength(1_200 - 366);
    expect(await rowsOf(a.companyId)).toHaveLength(4);
  });
});
