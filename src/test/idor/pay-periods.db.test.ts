/**
 * Aggregates on read and the period-close snapshot (Workia 2.0 P-02). Company
 * B cannot read A's aggregates or snapshot; the close and its snapshot commit
 * or roll back together (fault injection with triggers); a reopen leaves an
 * audit event and the next close a new snapshot. Titles are the surface ids
 * in docs/idor-matrix.md.
 */
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  auditEvents,
  incidenciasPeriodSnapshot,
  payPeriods,
} from "@/lib/db/schema";
import {
  closePayPeriod,
  getPayPeriod,
  quincenaRange,
  readPeriodSnapshot,
  reopenPayPeriod,
} from "@/lib/pay-periods";
import {
  appendPersonEvents,
  attendanceDedupeKey,
  sourceDedupeKey,
  type PersonEventInput,
} from "@/lib/timeline";
import { absenteeismBy, incidenciasBy } from "@/lib/timeline/aggregates";

import { ownerDb, seedTenant, type Tenant } from "./fixtures";

let a: Tenant;
let b: Tenant;
let seq = 0;

const Q1 = "2026-11-Q1";
const NOVEMBER = { from: "2026-11-01", to: "2026-11-30" };

const attendance = (
  personId: string,
  day: string,
  siteId?: string,
): PersonEventInput => ({
  personId,
  type: "attendance",
  occurredAt: new Date(`${day}T14:00:00Z`),
  source: "checador",
  dedupeKey: attendanceDedupeKey(day),
  payload: { site_id: siteId, first_in: "08:00", last_out: "17:00" },
});

const incidencia = (
  personId: string,
  day: string,
  payload: Record<string, unknown>,
  occurredAt = new Date(`${day}T15:00:00Z`),
): PersonEventInput => ({
  personId,
  type: "incidencia",
  occurredAt,
  source: "engine",
  dedupeKey: sourceDedupeKey("incidencia", "engine", `t${(seq += 1)}`),
  payload: { date: day, minutes: 0, justified: false, ...payload },
});

const snapshotOf = (companyId: string) =>
  ownerDb
    .select()
    .from(incidenciasPeriodSnapshot)
    .where(eq(incidenciasPeriodSnapshot.companyId, companyId));

beforeAll(async () => {
  a = await seedTenant("PPA");
  b = await seedTenant("PPB");
  const site = a.site.id;
  const ana = a.person.id;
  const tere = a.teammate.id;

  await appendPersonEvents(a.companyId, [
    ...["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"].map((day) =>
      attendance(ana, day, site),
    ),
    incidencia(ana, "2026-11-06", { kind: "falta", site_id: site }),
    incidencia(ana, "2026-11-03", {
      kind: "retardo",
      minutes: 15,
      site_id: site,
    }),
    incidencia(ana, "2026-11-04", {
      kind: "retardo",
      minutes: 10,
      site_id: site,
    }),
    // A correction is a new event with a higher rev: justified.
    incidencia(ana, "2026-11-04", {
      kind: "retardo",
      minutes: 10,
      site_id: site,
      justified: true,
      rev: 1,
    }),
    incidencia(ana, "2026-11-05", {
      kind: "salida_anticipada",
      minutes: 30,
      site_id: site,
    }),
    // ...and voided cancels it.
    incidencia(ana, "2026-11-05", {
      kind: "salida_anticipada",
      minutes: 30,
      site_id: site,
      voided: true,
      rev: 1,
    }),
    // Second quincena.
    incidencia(ana, "2026-11-16", { kind: "falta", site_id: site }),
    // Another period, for the fault-injection tests.
    incidencia(ana, "2026-10-20", { kind: "falta", site_id: site }),
    incidencia(ana, "2026-10-21", { kind: "falta", site_id: site }),
    attendance(tere, "2026-11-09"),
    incidencia(tere, "2026-11-10", { kind: "falta", justified: true }),
    // The evening of the 15th in Mexico is the 16th in UTC: still Q1.
    incidencia(
      tere,
      "2026-11-15",
      { kind: "retardo", minutes: 5 },
      new Date("2026-11-16T03:00:00Z"),
    ),
  ]);
});

afterEach(async () => {
  await ownerDb.execute(sql`
    drop trigger if exists fail_close on pay_periods;
    drop trigger if exists fail_snapshot on incidencias_period_snapshot;
    drop function if exists p02_fail();`);
});

/** Drizzle wraps the database error; the trigger's message is the cause. */
const INJECTED = {
  cause: expect.objectContaining({ message: "injected fault" }),
};

const injectFault = async (
  table: "pay_periods" | "incidencias_period_snapshot",
) => {
  await ownerDb.execute(sql`
    create function p02_fail() returns trigger language plpgsql as $$
    begin raise exception 'injected fault'; end $$`);
  await ownerDb.execute(
    table === "pay_periods"
      ? sql`create trigger fail_close before update on pay_periods for each row execute function p02_fail()`
      : sql`create trigger fail_snapshot before insert on incidencias_period_snapshot for each row execute function p02_fail()`,
  );
};

describe("lib:timeline/aggregates/incidenciasBy", () => {
  it("adds up the incidencias in force per person: the highest rev wins and voided ones drop", async () => {
    expect(
      await incidenciasBy(a.companyId, quincenaRange(Q1), { by: "person" }),
    ).toEqual(
      [
        { key: a.person.id, kind: "falta", count: 1, justified: 0, minutes: 0 },
        {
          key: a.person.id,
          kind: "retardo",
          count: 2,
          justified: 1,
          minutes: 25,
        },
        {
          key: a.teammate.id,
          kind: "falta",
          count: 1,
          justified: 1,
          minutes: 0,
        },
        {
          key: a.teammate.id,
          kind: "retardo",
          count: 1,
          justified: 0,
          minutes: 5,
        },
      ].sort((x, y) => `${x.key}${x.kind}`.localeCompare(`${y.key}${y.kind}`)),
    );
  });

  it("groups by the person's site and by month", async () => {
    expect(
      await incidenciasBy(a.companyId, NOVEMBER, {
        by: "site",
        siteId: a.site.id,
      }),
    ).toEqual([
      { key: a.site.id, kind: "falta", count: 2, justified: 0, minutes: 0 },
      { key: a.site.id, kind: "retardo", count: 2, justified: 1, minutes: 25 },
    ]);
    expect(
      await incidenciasBy(
        a.companyId,
        { from: "2026-10-01", to: "2026-11-30" },
        { by: "month" },
      ),
    ).toEqual([
      { key: "2026-10", kind: "falta", count: 2, justified: 0, minutes: 0 },
      { key: "2026-11", kind: "falta", count: 3, justified: 1, minutes: 0 },
      { key: "2026-11", kind: "retardo", count: 3, justified: 1, minutes: 30 },
    ]);
  });

  it("returns nothing for company A's people or site asked through company B", async () => {
    expect(
      await incidenciasBy(b.companyId, NOVEMBER, {
        by: "person",
        personIds: [a.person.id],
      }),
    ).toEqual([]);
    expect(
      await incidenciasBy(b.companyId, NOVEMBER, {
        by: "site",
        siteId: a.site.id,
      }),
    ).toEqual([]);
    expect(
      await incidenciasBy(b.companyId, NOVEMBER, { by: "person" }),
    ).toEqual([]);
  });

  it("refuses a reversed or too long range", async () => {
    await expect(
      incidenciasBy(
        a.companyId,
        { from: "2026-11-02", to: "2026-11-01" },
        {
          by: "person",
        },
      ),
    ).rejects.toThrow(/anterior/);
    await expect(
      incidenciasBy(
        a.companyId,
        { from: "2025-01-01", to: "2026-11-01" },
        {
          by: "person",
        },
      ),
    ).rejects.toThrow(/máximo/);
  });
});

describe("lib:timeline/aggregates/absenteeismBy", () => {
  it("is faltas over the days with attendance or a falta, per site, person and month", async () => {
    expect(
      await absenteeismBy(a.companyId, quincenaRange(Q1), {
        by: "site",
        siteId: a.site.id,
      }),
    ).toEqual([
      {
        key: a.site.id,
        presentDays: 4,
        absentDays: 1,
        justifiedAbsentDays: 0,
        rate: 0.2,
      },
    ]);
    expect(
      await absenteeismBy(a.companyId, NOVEMBER, {
        by: "person",
        personIds: [a.teammate.id],
      }),
    ).toEqual([
      {
        key: a.teammate.id,
        presentDays: 1,
        absentDays: 1,
        justifiedAbsentDays: 1,
        rate: 0.5,
      },
    ]);
    expect(await absenteeismBy(a.companyId, NOVEMBER, { by: "month" })).toEqual(
      [
        {
          key: "2026-11",
          presentDays: 5,
          absentDays: 3,
          justifiedAbsentDays: 1,
          rate: 0.375,
        },
      ],
    );
  });

  it("returns nothing for company A's site asked through company B", async () => {
    expect(
      await absenteeismBy(b.companyId, NOVEMBER, {
        by: "site",
        siteId: a.site.id,
      }),
    ).toEqual([]);
  });
});

describe("lib:pay-periods/closePayPeriod", () => {
  it("rolls the close back with its snapshot when marking the period closed fails", async () => {
    await injectFault("pay_periods");

    await expect(
      closePayPeriod(a.companyId, "2026-10-Q2"),
    ).rejects.toMatchObject(INJECTED);
    expect(await snapshotOf(a.companyId)).toEqual([]);
    expect(await getPayPeriod(a.companyId, "2026-10-Q2")).toBeNull();
  });

  it("leaves the period open when writing the snapshot fails", async () => {
    await injectFault("incidencias_period_snapshot");

    await expect(
      closePayPeriod(a.companyId, "2026-10-Q2"),
    ).rejects.toMatchObject(INJECTED);
    expect(await snapshotOf(a.companyId)).toEqual([]);
    expect(await getPayPeriod(a.companyId, "2026-10-Q2")).toBeNull();
  });

  it("freezes the period's incidencias, matching a recomputation from person_events", async () => {
    const closed = await closePayPeriod(a.companyId, Q1, {
      actorUserId: a.admin.id,
    });

    expect(closed.snapshotRows).toBe(4);
    expect(closed.period).toMatchObject({
      period: Q1,
      startsOn: "2026-11-01",
      endsOn: "2026-11-15",
      status: "closed",
      revision: 1,
    });

    const snapshot = await readPeriodSnapshot(a.companyId, Q1);
    const live = await incidenciasBy(a.companyId, quincenaRange(Q1), {
      by: "person",
    });

    expect(snapshot?.rows).toEqual(
      live.map(({ key, ...rest }) => ({ personId: key, ...rest })),
    );

    // An incidencia written after the close does not change the snapshot.
    await appendPersonEvents(a.companyId, [
      incidencia(a.person.id, "2026-11-12", { kind: "falta" }),
    ]);
    expect((await readPeriodSnapshot(a.companyId, Q1))?.rows).toEqual(
      snapshot?.rows,
    );

    const [event] = await ownerDb
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.companyId, a.companyId),
          eq(auditEvents.resourceType, "pay_period"),
          eq(auditEvents.action, "close"),
        ),
      );
    expect(event).toMatchObject({
      resourceId: closed.period.id,
      actorUserId: a.admin.id,
    });
  });

  it("refuses closing a closed period", async () => {
    await expect(closePayPeriod(a.companyId, Q1)).rejects.toMatchObject({
      code: "already_closed",
    });
  });

  it("closes company B's period of the same name without touching A's", async () => {
    const before = await snapshotOf(a.companyId);
    const closed = await closePayPeriod(b.companyId, Q1);

    expect(closed.snapshotRows).toBe(0);
    expect(await snapshotOf(a.companyId)).toEqual(before);
    expect(await snapshotOf(b.companyId)).toEqual([]);
  });

  it("lets only one of two concurrent closes write", async () => {
    const results = await Promise.allSettled([
      closePayPeriod(a.companyId, "2026-10-Q2"),
      closePayPeriod(a.companyId, "2026-10-Q2"),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    const period = await getPayPeriod(a.companyId, "2026-10-Q2");
    const rows = await ownerDb
      .select()
      .from(incidenciasPeriodSnapshot)
      .where(eq(incidenciasPeriodSnapshot.payPeriodId, period!.id));
    expect(rows).toEqual([
      expect.objectContaining({
        personId: a.person.id,
        kind: "falta",
        count: 2,
      }),
    ]);
  });
});

describe("lib:pay-periods/readPeriodSnapshot", () => {
  it("returns nothing for an open period or another company's", async () => {
    expect(await readPeriodSnapshot(a.companyId, "2026-11-Q2")).toBeNull();
    expect((await readPeriodSnapshot(b.companyId, Q1))?.rows).toEqual([]);
  });
});

describe("lib:pay-periods/reopenPayPeriod", () => {
  it("needs a reason and a closed period", async () => {
    await expect(
      reopenPayPeriod(a.companyId, Q1, { reason: "  " }),
    ).rejects.toMatchObject({ code: "reason_required" });
    await expect(
      reopenPayPeriod(a.companyId, "2026-11-Q2", { reason: "Corrección" }),
    ).rejects.toMatchObject({ code: "not_closed" });
  });

  it("keeps the snapshot when the reopen fails", async () => {
    const before = await snapshotOf(a.companyId);
    await injectFault("pay_periods");

    await expect(
      reopenPayPeriod(a.companyId, Q1, { reason: "Corrección" }),
    ).rejects.toMatchObject(INJECTED);
    expect(await snapshotOf(a.companyId)).toEqual(before);
    expect((await getPayPeriod(a.companyId, Q1))?.status).toBe("closed");
  });

  it("refuses company B reopening company A's period", async () => {
    await closePayPeriod(a.companyId, "2026-09-Q1");
    await expect(
      reopenPayPeriod(b.companyId, "2026-09-Q1", { reason: "Corrección" }),
    ).rejects.toMatchObject({ code: "not_closed" });
    expect((await getPayPeriod(a.companyId, "2026-09-Q1"))?.status).toBe(
      "closed",
    );
  });

  it("leaves an event, and the next close writes a new snapshot and revision", async () => {
    const reopened = await reopenPayPeriod(a.companyId, Q1, {
      reason: "Falta del 12 capturada tarde",
      actorUserId: a.admin.id,
    });

    expect(reopened.deletedRows).toBe(4);
    expect(reopened.period).toMatchObject({ status: "open", closedAt: null });
    expect(await readPeriodSnapshot(a.companyId, Q1)).toBeNull();

    const [event] = await ownerDb
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.companyId, a.companyId),
          eq(auditEvents.action, "reopen"),
        ),
      );
    expect(event.payload).toMatchObject({
      summary: expect.stringContaining("Falta del 12 capturada tarde"),
    });

    const again = await closePayPeriod(a.companyId, Q1);
    expect(again.period.revision).toBe(2);
    expect(
      (await readPeriodSnapshot(a.companyId, Q1))?.rows.find(
        (row) => row.personId === a.person.id && row.kind === "falta",
      ),
    ).toMatchObject({ count: 2 });

    const [row] = await ownerDb
      .select({ revision: payPeriods.revision })
      .from(payPeriods)
      .where(eq(payPeriods.id, again.period.id));
    expect(row.revision).toBe(2);
  });
});

describe("lib:pay-periods/getPayPeriod", () => {
  it("does not show company A's period to company B", async () => {
    expect((await getPayPeriod(a.companyId, "2026-09-Q1"))?.status).toBe(
      "closed",
    );
    expect(await getPayPeriod(b.companyId, "2026-09-Q1")).toBeNull();
  });
});
