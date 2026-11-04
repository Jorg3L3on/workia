/**
 * Period close wired to the engine output (Workia 2.0 W2-15). The engine's
 * writer refuses a closed quincena and holds an open one while it writes, so a
 * close snapshots the engine's last output; the snapshot of a closed period
 * matches a recomputation from person_events, and a reopen leaves an event
 * and a new snapshot. The list, detail and today counts read the P-02
 * aggregates, scoped to one company. Titles are the surface ids in
 * docs/idor-matrix.md.
 */
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { withTransaction } from "@/lib/db";
import { auditEvents, personEvents } from "@/lib/db/schema";
import {
  closePayPeriod,
  getPayPeriod,
  getPayPeriodDetail,
  listPayPeriods,
  loadPayPeriodIncidencias,
  PayPeriodError,
  readPeriodSnapshot,
  reopenPayPeriod,
  verifyPeriodSnapshot,
} from "@/lib/pay-periods";
import {
  appendPersonEvents,
  attendanceDedupeKey,
  sourceDedupeKey,
} from "@/lib/timeline";
import { todayCounts } from "@/lib/timeline/today";
import { replacePeriodIncidencias } from "@/lib/timeline/writers";
import {
  closePayPeriodAction,
  reopenPayPeriodAction,
} from "@/lib/pay-periods/actions";
import { PAY_PERIOD_COPY } from "@/lib/pay-periods/copy";
import { STALE_COMPANY_MESSAGE } from "@/lib/tenant/scope";

import { ownerDb, seedTenant, type Tenant } from "./fixtures";
import { actAs } from "./session-state";

const formData = (values: Record<string, string>) => {
  const data = new FormData();

  for (const [key, value] of Object.entries(values)) {
    data.set(key, value);
  }

  return data;
};

let a: Tenant;
let b: Tenant;

const Q = "2027-03-Q1";
const engine = "engine";

const retardo = (personId: string, day: string, minutes: number) => ({
  personId,
  day,
  kind: "retardo" as const,
  minutes,
  source: engine,
});

const falta = (personId: string, day: string, justified = false) => ({
  personId,
  day,
  kind: "falta" as const,
  justified,
  source: engine,
});

const closeEvents = (companyId: string, action: "close" | "reopen") =>
  ownerDb
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.companyId, companyId),
        eq(auditEvents.resourceType, "pay_period"),
        eq(auditEvents.action, action),
      ),
    );

beforeAll(async () => {
  a = await seedTenant("PCA");
  b = await seedTenant("PCB");
});

describe("lib:timeline/writers/replacePeriodIncidencias", () => {
  it("takes a quincena and only days inside it", async () => {
    await expect(
      replacePeriodIncidencias(a.companyId, {
        period: "2027-03-1",
        personIds: [a.person.id],
        incidencias: [],
      }),
    ).rejects.toMatchObject({ code: "invalid_period" });
    await expect(
      replacePeriodIncidencias(a.companyId, {
        period: Q,
        personIds: [a.person.id],
        incidencias: [falta(a.person.id, "2027-03-16")],
      }),
    ).rejects.toMatchObject({ code: "outside_period" });
  });

  it("refuses a closed period and writes nothing; after a reopen the next close has the new output", async () => {
    const ana = a.person.id;
    const tere = a.teammate.id;

    await replacePeriodIncidencias(a.companyId, {
      period: Q,
      personIds: [ana, tere],
      incidencias: [
        retardo(ana, "2027-03-02", 12),
        retardo(ana, "2027-03-03", 8),
        falta(tere, "2027-03-04"),
      ],
    });
    const first = await closePayPeriod(a.companyId, Q, {
      actorUserId: a.admin.id,
    });
    expect(first).toMatchObject({
      snapshotRows: 2,
      period: { status: "closed", revision: 1 },
    });

    const before = await ownerDb
      .select({ id: personEvents.id })
      .from(personEvents)
      .where(eq(personEvents.companyId, a.companyId));
    const refused = replacePeriodIncidencias(a.companyId, {
      period: Q,
      personIds: [ana, tere],
      incidencias: [falta(tere, "2027-03-04", true)],
    });
    await expect(refused).rejects.toBeInstanceOf(PayPeriodError);
    await expect(refused).rejects.toMatchObject({ code: "period_closed" });
    expect(
      await ownerDb
        .select({ id: personEvents.id })
        .from(personEvents)
        .where(eq(personEvents.companyId, a.companyId)),
    ).toEqual(before);

    // The snapshot of a closed period matches a recomputation.
    expect(await verifyPeriodSnapshot(a.companyId, Q)).toMatchObject({
      matches: true,
      differences: [],
    });

    await reopenPayPeriod(a.companyId, Q, {
      reason: "Permiso de Tere capturado tarde",
      actorUserId: a.admin.id,
    });
    expect(
      await replacePeriodIncidencias(a.companyId, {
        period: Q,
        personIds: [ana, tere],
        incidencias: [
          retardo(ana, "2027-03-02", 12),
          retardo(ana, "2027-03-03", 8),
          falta(tere, "2027-03-04", true),
        ],
      }),
    ).toEqual({ inserted: 1, deleted: 1, unchanged: 2 });

    const second = await closePayPeriod(a.companyId, Q, {
      actorUserId: a.admin.id,
    });
    expect(second.period.revision).toBe(2);

    const snapshot = await readPeriodSnapshot(a.companyId, Q);
    expect(snapshot?.rows).toEqual(
      expect.arrayContaining([
        { personId: ana, kind: "retardo", count: 2, justified: 0, minutes: 20 },
        { personId: tere, kind: "falta", count: 1, justified: 1, minutes: 0 },
      ]),
    );
    expect(snapshot?.rows).toHaveLength(2);
    expect(await verifyPeriodSnapshot(a.companyId, Q)).toMatchObject({
      matches: true,
    });

    // The reopen left an event with its reason; each close left one too.
    const reopens = await closeEvents(a.companyId, "reopen");
    expect(reopens).toHaveLength(1);
    expect(JSON.stringify(reopens[0].payload)).toContain(
      "Permiso de Tere capturado tarde",
    );
    expect(await closeEvents(a.companyId, "close")).toHaveLength(2);
  });

  it("makes a close wait for an engine write in flight, and snapshots it", async () => {
    const period = "2027-04-Q1";
    const ana = a.person.id;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let wrote!: () => void;
    const written = new Promise<void>((resolve) => {
      wrote = resolve;
    });

    const write = withTransaction(async (tx) => {
      await replacePeriodIncidencias(
        a.companyId,
        {
          period,
          personIds: [ana],
          incidencias: [falta(ana, "2027-04-05"), falta(ana, "2027-04-06")],
        },
        tx,
      );
      wrote();
      await held;
    }, a.companyId);

    await written;
    let closedAt = 0;
    const close = closePayPeriod(a.companyId, period).then((result) => {
      closedAt = Date.now();
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    // Still waiting for the engine's transaction.
    expect(closedAt).toBe(0);
    const releasedAt = Date.now();
    release();
    await write;

    const result = await close;
    expect(closedAt).toBeGreaterThanOrEqual(releasedAt);
    expect(result.snapshotRows).toBe(1);
    expect((await readPeriodSnapshot(a.companyId, period))?.rows).toEqual([
      { personId: ana, kind: "falta", count: 2, justified: 0, minutes: 0 },
    ]);
  });
});

describe("lib:pay-periods/verifyPeriodSnapshot", () => {
  it("reports an incidencia written after the close, and is null while open", async () => {
    const period = "2027-05-Q2";
    const tere = a.teammate.id;

    await replacePeriodIncidencias(a.companyId, {
      period,
      personIds: [tere],
      incidencias: [retardo(tere, "2027-05-20", 5)],
    });
    expect(await verifyPeriodSnapshot(a.companyId, period)).toBeNull();
    await closePayPeriod(a.companyId, period);

    // Something other than the engine appends an incidencia of the period.
    await appendPersonEvents(a.companyId, [
      {
        personId: tere,
        type: "incidencia",
        occurredAt: new Date("2027-05-21T18:00:00Z"),
        source: "app",
        dedupeKey: sourceDedupeKey("incidencia", "app", "late-1"),
        payload: { date: "2027-05-21", kind: "falta", justified: false },
      },
    ]);

    const check = await verifyPeriodSnapshot(a.companyId, period);
    expect(check?.matches).toBe(false);
    expect(check?.differences).toEqual([
      {
        personId: tere,
        kind: "falta",
        snapshot: null,
        live: { count: 1, justified: 0, minutes: 0 },
      },
    ]);
    // The snapshot itself did not move.
    expect((await readPeriodSnapshot(a.companyId, period))?.rows).toEqual([
      { personId: tere, kind: "retardo", count: 1, justified: 0, minutes: 5 },
    ]);
    // Company B sees no period of that name.
    expect(await verifyPeriodSnapshot(b.companyId, period)).toBeNull();
  });
});

describe("lib:pay-periods/listPayPeriods", () => {
  it("lists quincenas newest first with their status, page after page", async () => {
    const first = await listPayPeriods(a.companyId, {
      today: "2027-05-25",
      limit: 4,
    });
    expect(first.items.map((item) => item.period)).toEqual([
      "2027-05-Q2",
      "2027-05-Q1",
      "2027-04-Q2",
      "2027-04-Q1",
    ]);
    expect(first.items[0]).toMatchObject({
      current: true,
      status: "closed",
      revision: 1,
      startsOn: "2027-05-16",
      endsOn: "2027-05-31",
      label: "2.ª quincena de mayo 2027",
    });
    expect(first.items[1]).toMatchObject({ status: "open", revision: 0 });
    expect(first.next).toBe("2027-04-Q1");

    const second = await listPayPeriods(a.companyId, {
      today: "2027-05-25",
      cursor: first.next,
      limit: 4,
    });
    expect(second.items.map((item) => item.period)).toEqual([
      "2027-03-Q2",
      "2027-03-Q1",
      "2027-02-Q2",
      "2027-02-Q1",
    ]);
    expect(second.items[1]).toMatchObject({ status: "closed", revision: 2 });

    // A cursor that is not a quincena starts over.
    expect(
      (
        await listPayPeriods(a.companyId, {
          today: "2027-05-25",
          cursor: "'; drop table pay_periods; --",
          limit: 1,
        })
      ).items[0].period,
    ).toBe("2027-05-Q2");
  });

  it("does not show company A's closes to company B", async () => {
    const page = await listPayPeriods(b.companyId, {
      today: "2027-05-25",
      limit: 6,
    });
    expect(page.items.every((item) => item.status === "open")).toBe(true);
    expect(page.items.every((item) => item.revision === 0)).toBe(true);
  });
});

describe("lib:pay-periods/getPayPeriodDetail", () => {
  it("reads the snapshot once closed and the live aggregate while open, by person in name order", async () => {
    const closed = await getPayPeriodDetail(a.companyId, Q);
    expect(closed).toMatchObject({
      status: "closed",
      source: "snapshot",
      revision: 2,
      personCount: 2,
      totals: {
        retardo: { count: 2, justified: 0, minutes: 20 },
        falta: { count: 1, justified: 1, minutes: 0 },
      },
    });
    expect(closed.people.map((row) => row.personId).sort()).toEqual(
      [a.person.id, a.teammate.id].sort(),
    );

    const paged = await getPayPeriodDetail(a.companyId, Q, { limit: 1 });
    expect(paged.people).toHaveLength(1);
    expect(paged.next).not.toBeNull();
    const rest = await getPayPeriodDetail(a.companyId, Q, {
      limit: 1,
      cursor: paged.next,
    });
    expect(rest.people).toHaveLength(1);
    expect(rest.next).toBeNull();
    expect(rest.people[0].personId).not.toBe(paged.people[0].personId);

    await reopenPayPeriod(a.companyId, Q, { reason: "Revisión" });
    const open = await getPayPeriodDetail(a.companyId, Q);
    expect(open).toMatchObject({
      status: "open",
      source: "live",
      revision: 2,
      totals: closed.totals,
    });
    await closePayPeriod(a.companyId, Q);
  });

  it("gives company B nothing of company A's quincena", async () => {
    const detail = await getPayPeriodDetail(b.companyId, Q);
    expect(detail).toMatchObject({
      status: "open",
      revision: 0,
      personCount: 0,
      people: [],
      totals: {},
    });
  });
});

describe("lib:timeline/today/todayCounts", () => {
  it("counts the day from the aggregates for one site, and nothing across companies", async () => {
    const day = "2027-06-01";
    const ana = a.person.id;
    const site = a.site.id;
    const [person] = await ownerDb
      .execute(sql`select site_id from people where id = ${ana}`)
      .then((result) => result.rows as Array<{ site_id: string | null }>);

    await appendPersonEvents(a.companyId, [
      {
        personId: ana,
        type: "attendance",
        occurredAt: new Date(`${day}T14:00:00Z`),
        source: "checador",
        dedupeKey: attendanceDedupeKey(day),
        payload: { site_id: site, punches: [] },
      },
    ]);
    await replacePeriodIncidencias(a.companyId, {
      period: "2027-06-Q1",
      personIds: [ana],
      incidencias: [retardo(ana, day, 9)],
    });

    const scope = { siteId: person.site_id ?? site };
    const counts = await todayCounts(a.companyId, scope, day);
    expect(counts).toMatchObject({
      present: 1,
      absent: 0,
      late: 1,
      leftEarly: 0,
    });
    expect(counts.roster).toBeGreaterThanOrEqual(1);

    expect(await todayCounts(b.companyId, scope, day)).toEqual({
      roster: 0,
      present: 0,
      absent: 0,
      late: 0,
      leftEarly: 0,
    });
  });
});

describe("lib:pay-periods/loadPayPeriodIncidencias", () => {
  it("gives company B none of company A's people", async () => {
    const own = await loadPayPeriodIncidencias(a.companyId, Q);
    expect(own.personCount).toBe(2);
    const foreign = await loadPayPeriodIncidencias(b.companyId, Q);
    expect(foreign.sorted).toEqual([]);
  });
});

describe("lib:pay-periods/getPayPeriod (after W2-15)", () => {
  it("keeps one row per quincena that the engine wrote or someone closed", async () => {
    expect(await getPayPeriod(a.companyId, "2027-06-Q1")).toMatchObject({
      status: "open",
      revision: 0,
    });
    expect(await getPayPeriod(b.companyId, "2027-06-Q1")).toBeNull();
  });
});

describe("pay period actions across companies", () => {
  it("action:pay-periods/closePayPeriodAction", async () => {
    const period = "2026-01-Q1";

    actAs(b.admin);
    expect(
      await closePayPeriodAction(
        {},
        formData({ companyId: a.companyId, period }),
      ),
    ).toEqual({ error: STALE_COMPANY_MESSAGE });
    expect(await getPayPeriod(a.companyId, period)).toBeNull();

    // Company B closing its own quincena of the same name leaves A's alone.
    expect(await closePayPeriodAction({}, formData({ period }))).toMatchObject({
      ok: true,
    });
    expect(await getPayPeriod(a.companyId, period)).toBeNull();
    expect(await getPayPeriod(b.companyId, period)).toMatchObject({
      status: "closed",
    });
    expect(
      await closePayPeriodAction({}, formData({ period: "2999-01-Q1" })),
    ).toEqual({ error: PAY_PERIOD_COPY.notStarted });
    expect(
      await closePayPeriodAction({}, formData({ period: "2027-01-1" })),
    ).toEqual({ error: PAY_PERIOD_COPY.invalidPeriod });
  });

  it("action:pay-periods/reopenPayPeriodAction", async () => {
    actAs(b.admin);
    expect(
      await reopenPayPeriodAction(
        {},
        formData({ companyId: a.companyId, period: Q, reason: "Intento" }),
      ),
    ).toEqual({ error: STALE_COMPANY_MESSAGE });
    // B has no closed quincena of that name; A's stays closed.
    expect(
      await reopenPayPeriodAction(
        {},
        formData({ period: Q, reason: "Intento" }),
      ),
    ).toEqual({ error: expect.stringContaining("no está cerrado") });
    expect(await getPayPeriod(a.companyId, Q)).toMatchObject({
      status: "closed",
    });
  });
});

describe("pay period permissions", () => {
  it("rbac:action:pay-periods/closePayPeriodAction", async () => {
    for (const user of [a.viewer, a.editor]) {
      actAs(user);
      expect(
        await closePayPeriodAction({}, formData({ period: "2027-02-Q1" })),
      ).toEqual({ error: PAY_PERIOD_COPY.denied });
    }
    expect(await getPayPeriod(a.companyId, "2027-02-Q1")).toBeNull();
  });

  it("rbac:action:pay-periods/reopenPayPeriodAction", async () => {
    for (const user of [a.viewer, a.editor]) {
      actAs(user);
      expect(
        await reopenPayPeriodAction(
          {},
          formData({ period: Q, reason: "Sin permiso" }),
        ),
      ).toEqual({ error: PAY_PERIOD_COPY.denied });
    }
    expect(await getPayPeriod(a.companyId, Q)).toMatchObject({
      status: "closed",
    });

    actAs(a.admin);
    expect(
      await reopenPayPeriodAction({}, formData({ period: Q, reason: "" })),
    ).toEqual({ error: expect.stringContaining("motivo") });
    expect(
      await reopenPayPeriodAction(
        {},
        formData({ period: Q, reason: "Corrección de RH" }),
      ),
    ).toEqual({ ok: true, message: PAY_PERIOD_COPY.reopened });
    // A quincena that has not started cannot be closed from the screen.
    expect(await closePayPeriodAction({}, formData({ period: Q }))).toEqual({
      error: PAY_PERIOD_COPY.notStarted,
    });
    await closePayPeriod(a.companyId, Q, { actorUserId: a.admin.id });
    expect(await getPayPeriod(a.companyId, Q)).toMatchObject({
      status: "closed",
      revision: 4,
    });
  });
});
