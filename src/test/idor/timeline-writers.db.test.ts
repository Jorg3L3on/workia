/**
 * The timeline batch writers (Workia 2.0 W2-13). Company B cannot write,
 * merge, replace or delete events of company A's person through them. Titles
 * are the surface ids in docs/idor-matrix.md.
 */
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { withTransaction } from "@/lib/db";
import { CompanyReferenceError } from "@/lib/db/errors";
import { personEvents } from "@/lib/db/schema";
import {
  appendEmploymentChanges,
  replacePeriodIncidencias,
  writeAttendanceDays,
} from "@/lib/timeline/writers";

import { ownerDb, seedTenant, type Tenant } from "./fixtures";

let a: Tenant;
let b: Tenant;

const rowsOf = (personId: string) =>
  ownerDb
    .select()
    .from(personEvents)
    .where(eq(personEvents.personId, personId))
    .orderBy(personEvents.dedupeKey);

const day = (personId: string, at: string, kind: "in" | "out") => ({
  personId,
  day: "2026-11-03",
  source: "checador",
  punches: [{ at, kind }],
});

beforeAll(async () => {
  a = await seedTenant("TWA");
  b = await seedTenant("TWB");
  await writeAttendanceDays(a.companyId, [
    day(a.person.id, "2026-11-03T14:00:00Z", "in"),
  ]);
  await replacePeriodIncidencias(a.companyId, {
    period: "2026-11-1",
    personIds: [a.person.id],
    incidencias: [
      {
        personId: a.person.id,
        day: "2026-11-03",
        kind: "retardo",
        minutes: 5,
        source: "engine",
      },
    ],
  });
});

describe("lib:timeline/writers/writeAttendanceDays", () => {
  it("refuses company B writing or merging a day of company A's person", async () => {
    const before = await rowsOf(a.person.id);

    await expect(
      writeAttendanceDays(b.companyId, [
        day(a.person.id, "2026-11-03T23:00:00Z", "out"),
      ]),
    ).rejects.toBeInstanceOf(CompanyReferenceError);
    expect(await rowsOf(a.person.id)).toEqual(before);
  });
});

describe("lib:timeline/writers/replacePeriodIncidencias", () => {
  it("never deletes or writes company A's incidencias from company B", async () => {
    const before = await rowsOf(a.person.id);

    // An empty recomputation from B would delete A's rows if it saw them.
    await expect(
      replacePeriodIncidencias(b.companyId, {
        period: "2026-11-1",
        personIds: [a.person.id],
        incidencias: [],
      }),
    ).rejects.toBeInstanceOf(CompanyReferenceError);
    await expect(
      replacePeriodIncidencias(b.companyId, {
        period: "2026-11-1",
        personIds: [a.person.id],
        incidencias: [
          {
            personId: a.person.id,
            day: "2026-11-04",
            kind: "falta",
            source: "engine",
          },
        ],
      }),
    ).rejects.toBeInstanceOf(CompanyReferenceError);
    expect(await rowsOf(a.person.id)).toEqual(before);
  });
});

describe("lib:timeline/writers/appendEmploymentChanges", () => {
  it("refuses a «cambio» for company A's person under company B", async () => {
    const before = await rowsOf(a.person.id);

    await expect(
      withTransaction(
        (tx) =>
          appendEmploymentChanges(
            b.companyId,
            [
              {
                id: "00000000-0000-0000-0000-00000000c0de",
                resourceType: "person",
                resourceId: a.person.id,
                action: "update",
                source: "app",
                occurredAt: new Date(),
                payload: {
                  changes: { siteId: { from: null, to: b.site.id } },
                },
              },
            ],
            tx,
          ),
        b.companyId,
      ),
    ).rejects.toBeInstanceOf(CompanyReferenceError);
    expect(await rowsOf(a.person.id)).toEqual(before);
  });
});
