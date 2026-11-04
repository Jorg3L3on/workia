/**
 * Attendance ingestion (Workia 2.0 W2-12) on a real database. Company B
 * cannot read or change company A's checadores, numbers, uploads, unmatched
 * punches or check-in points, a role without attendance:manage is denied, and
 * the acceptance checks hold: a day's export ingests twice without
 * duplicates, unmatched punches are listed with the raw row, a device push is
 * idempotent, and an app check-in needs a genuine code and a phone inside the
 * site. Titles are the surface ids of docs/idor-matrix.md.
 */
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

const employee = vi.hoisted(() => ({
  context: null as null | {
    accountId: string;
    companyId: string;
    personId: string;
    sessionId: string;
  },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: () => {},
    delete: () => {},
  }),
  headers: async () =>
    new Headers({ host: "workia.test", "x-forwarded-proto": "https" }),
}));

vi.mock("@/lib/employee-accounts/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/employee-accounts/session")>()),
  getEmployeeContext: async () => employee.context,
}));

import { POST as pushRoute } from "@/app/api/asistencia/checadas/route";
import {
  assignBadge,
  ATTENDANCE_COPY,
  countOpenUnmatched,
  createAttendanceDevice,
  dismissUnmatched,
  importChecadorCsv,
  issueDeviceToken,
  listAttendanceBatches,
  listAttendanceDevices,
  listBadges,
  listCheckinSites,
  listOpenUnmatched,
  markDevicePush,
  removeBadge,
  rotateCheckinSecret,
  saveCheckinSite,
  setAttendanceDeviceActive,
  updateAttendanceDevice,
} from "@/lib/attendance";
import {
  assignBadgeAction,
  dismissUnmatchedAction,
  importChecadorCsvAction,
  issueDeviceTokenAction,
  kioskCodeAction,
  removeBadgeAction,
  rotateCheckinSecretAction,
  saveAttendanceDeviceAction,
  saveCheckinSiteAction,
  searchAttendancePeopleAction,
  setAttendanceDeviceActiveAction,
} from "@/lib/attendance/actions";
import {
  checkIn,
  checkinSiteFor,
  CHECKIN_COPY,
  qrCodeFor,
} from "@/lib/attendance/checkin";
import { checkInAction } from "@/lib/attendance/employee-actions";
import { ingestPunches } from "@/lib/attendance/ingest";
import {
  attendanceBadges,
  attendanceCheckinSites,
  attendanceDevices,
  attendanceUnmatched,
  auditEvents,
  personEvents,
} from "@/lib/db/schema";
import { STALE_COMPANY_MESSAGE } from "@/lib/tenant/scope";
import { readAttendance } from "@/lib/timeline/writers";

import { ownerDb, seedTenant, type Tenant } from "./fixtures";
import { actAs } from "./session-state";

let a: Tenant;
let b: Tenant;
let deviceA: string;
let deviceB: string;
let tokenA: string;

const SITE_A = { latitude: 19.4326, longitude: -99.1332 };
const NEAR_A = { latitude: 19.4331, longitude: -99.1332, accuracy: 20 }; // ~55 m
const FAR_A = { latitude: 19.45, longitude: -99.1332, accuracy: 20 }; // ~2 km

const FORMAT = {
  delimiter: "auto" as const,
  headerRows: 1,
  badgeColumn: "No.",
  dateTimeColumn: "Fecha/Hora",
  dateFormat: "DD/MM/YYYY" as const,
};

const EXPORT_A = [
  "No.,Nombre,Fecha/Hora",
  "0101,Persona,03/11/2026 08:12",
  "0101,Persona,03/11/2026 17:01",
  "777,Visitante,03/11/2026 09:00",
  "0101,Persona,mañana",
  "",
].join("\r\n");

const formData = (values: Record<string, string | File>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

const attendanceOf = async (personId: string) =>
  ownerDb
    .select()
    .from(personEvents)
    .where(
      and(
        eq(personEvents.personId, personId),
        eq(personEvents.type, "attendance"),
      ),
    );

const devicesOf = (companyId: string) =>
  ownerDb
    .select()
    .from(attendanceDevices)
    .where(eq(attendanceDevices.companyId, companyId));

const push = (token: string | null, body: unknown) =>
  pushRoute(
    new Request("https://workia.test/api/asistencia/checadas", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200)}`,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );

beforeAll(async () => {
  a = await seedTenant("AA");
  b = await seedTenant("AB");

  const createdA = await createAttendanceDevice(
    a.companyId,
    { name: "Checador A", siteId: a.site.id, csvFormat: FORMAT },
    a.admin.id,
  );
  const createdB = await createAttendanceDevice(
    b.companyId,
    { name: "Checador B", siteId: null, csvFormat: FORMAT },
    b.admin.id,
  );

  if (!createdA.ok || !createdB.ok)
    throw new Error("No se crearon los checadores.");

  deviceA = createdA.id;
  deviceB = createdB.id;

  const token = await issueDeviceToken(a.companyId, deviceA, a.admin.id);

  if (!token.ok) throw new Error("No se creó el token.");

  tokenA = token.token;

  await ownerDb
    .insert(attendanceBadges)
    .values({ companyId: a.companyId, personId: a.person.id, badge: "101" });

  const saved = await saveCheckinSite(
    a.companyId,
    {
      siteId: a.site.id,
      ...SITE_A,
      radiusMeters: 150,
      qrMode: "rotating",
      enabled: true,
    },
    a.admin.id,
  );

  if (!saved.ok) throw new Error("No se configuró el checado en la app.");
});

describe("acceptance: a day's export, twice", () => {
  it("ingests once, and the second upload adds and lists nothing new", async () => {
    const first = await importChecadorCsv(
      a.companyId,
      { deviceId: deviceA, fileName: "dia.csv", text: EXPORT_A },
      a.admin.id,
    );

    expect(first).toMatchObject({
      ok: true,
      summary: {
        rows: 4,
        punchesAdded: 2,
        duplicates: 0,
        unmatched: 1,
        invalid: 1,
      },
    });

    const second = await importChecadorCsv(
      a.companyId,
      { deviceId: deviceA, fileName: "dia.csv", text: EXPORT_A },
      a.admin.id,
    );

    expect(second).toMatchObject({
      ok: true,
      summary: {
        rows: 4,
        punchesAdded: 0,
        duplicates: 2,
        unmatched: 1,
        invalid: 1,
      },
    });

    const rows = await attendanceOf(a.person.id);

    expect(rows).toHaveLength(1);
    expect(rows[0].dedupeKey).toBe("attendance:2026-11-03");

    const day = readAttendance(rows[0].payload);

    expect(day.siteId).toBe(a.site.id);
    expect(day.punches.map((punch) => [punch.at, punch.kind])).toEqual([
      ["2026-11-03T14:12:00Z", "in"],
      ["2026-11-03T23:01:00Z", "out"],
    ]);

    // One report row per unplaced punch and per unreadable line, not two.
    const open = await ownerDb
      .select()
      .from(attendanceUnmatched)
      .where(eq(attendanceUnmatched.companyId, a.companyId));

    expect(open).toHaveLength(2);
  });

  it("lists unmatched punches with the raw row", async () => {
    const page = await listOpenUnmatched(a.companyId);
    const unknown = page.items.find((row) => row.reason === "unknown_badge");
    const invalid = page.items.find((row) => row.reason === "invalid_row");

    expect(unknown).toMatchObject({
      badge: "777",
      line: 4,
      raw: ["777", "Visitante", "03/11/2026 09:00"],
      deviceName: "Checador A",
    });
    expect(invalid?.raw.slice(0, 3)).toEqual(["0101", "Persona", "mañana"]);
    expect(invalid?.line).toBe(5);
  });

  it("places waiting punches when HR assigns the number", async () => {
    const result = await assignBadge(
      a.companyId,
      { badge: "0777", personId: a.teammate.id },
      a.admin.id,
    );

    expect(result).toEqual({ ok: true, placed: 1 });

    const rows = await attendanceOf(a.teammate.id);

    expect(rows).toHaveLength(1);
    expect(readAttendance(rows[0].payload).punches).toEqual([
      { at: "2026-11-03T15:00:00Z", kind: "in", device_id: deviceA },
    ]);
    expect(
      (await listOpenUnmatched(a.companyId)).items.map((row) => row.reason),
    ).toEqual(["invalid_row"]);
  });
});

describe("acceptance: device push", () => {
  it("is idempotent, and refuses an unknown token", async () => {
    const body = {
      punches: [
        { badge: "101", at: "2026-11-02 08:00:00", kind: "in" },
        { badge: "101", at: "2026-11-02T17:30:00-06:00" },
        { badge: "999", at: "2026-11-02 08:00:00" },
        { at: "nope" },
      ],
    };

    const first = await push(tokenA, body);

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      received: 4,
      added: 2,
      duplicates: 0,
      unmatched: 1,
      invalid: 1,
    });

    const again = await push(tokenA, body);

    expect(await again.json()).toMatchObject({ added: 0, duplicates: 2 });

    const day = (await attendanceOf(a.person.id)).find(
      (row) => row.dedupeKey === "attendance:2026-11-02",
    );

    expect(
      readAttendance(day!.payload).punches.map((punch) => punch.kind),
    ).toEqual(["in", "out"]);

    expect((await push("wkc_" + "x".repeat(32), body)).status).toBe(401);
    expect((await push(null, body)).status).toBe(401);
    expect((await push(tokenA, { punches: [] })).status).toBe(400);
  });
});

describe("attendance data stays inside the company", () => {
  it("route:POST /api/asistencia/checadas", async () => {
    // A's token writes only A's people: B's person with the same number is not matched.
    await ownerDb
      .insert(attendanceBadges)
      .values({ companyId: b.companyId, personId: b.person.id, badge: "555" });

    const response = await push(tokenA, {
      punches: [{ badge: "555", at: "2026-11-02 09:00:00" }],
    });

    expect(await response.json()).toMatchObject({ added: 0, unmatched: 1 });
    expect(await attendanceOf(b.person.id)).toEqual([]);
  });

  it("lib:attendance/listAttendanceDevices", async () => {
    const inB = await listAttendanceDevices(b.companyId);

    expect(inB.map((row) => row.id)).toEqual([deviceB]);
    expect(
      (await listAttendanceDevices(a.companyId)).map((row) => row.id),
    ).toContain(deviceA);
  });

  it("lib:attendance/createAttendanceDevice", async () => {
    expect(
      await createAttendanceDevice(
        b.companyId,
        { name: "Con sitio de A", siteId: a.site.id, csvFormat: FORMAT },
        b.admin.id,
      ),
    ).toEqual({ ok: false, error: ATTENDANCE_COPY.siteMissing });
    expect(
      await createAttendanceDevice(
        a.companyId,
        { name: "checador a", siteId: null, csvFormat: FORMAT },
        a.admin.id,
      ),
    ).toEqual({ ok: false, error: ATTENDANCE_COPY.deviceNameTaken });
  });

  it("lib:attendance/updateAttendanceDevice", async () => {
    const before = await devicesOf(a.companyId);

    expect(
      await updateAttendanceDevice(
        b.companyId,
        deviceA,
        { name: "Robado", siteId: null, csvFormat: FORMAT },
        b.admin.id,
      ),
    ).toEqual({ ok: false, error: ATTENDANCE_COPY.deviceMissing });
    expect(await devicesOf(a.companyId)).toEqual(before);
  });

  it("lib:attendance/issueDeviceToken", async () => {
    const before = await devicesOf(a.companyId);

    expect(await issueDeviceToken(b.companyId, deviceA, b.admin.id)).toEqual({
      ok: false,
      error: ATTENDANCE_COPY.deviceMissing,
    });
    expect(await devicesOf(a.companyId)).toEqual(before);
  });

  it("lib:attendance/setAttendanceDeviceActive", async () => {
    expect(
      await setAttendanceDeviceActive(b.companyId, deviceA, false, b.admin.id),
    ).toEqual({
      ok: false,
      error: ATTENDANCE_COPY.deviceMissing,
    });

    const [device] = await devicesOf(a.companyId).then((rows) =>
      rows.filter((row) => row.id === deviceA),
    );

    expect(device.active).toBe(true);
  });

  it("lib:attendance/markDevicePush", async () => {
    const before = await devicesOf(a.companyId);

    await markDevicePush(
      b.companyId,
      deviceA,
      new Date("2030-01-01T00:00:00Z"),
    );
    expect(await devicesOf(a.companyId)).toEqual(before);
  });

  it("lib:attendance/importChecadorCsv", async () => {
    expect(
      await importChecadorCsv(
        b.companyId,
        { deviceId: deviceA, fileName: "x.csv", text: EXPORT_A },
        b.admin.id,
      ),
    ).toEqual({ ok: false, error: ATTENDANCE_COPY.deviceMissing });
  });

  it("lib:attendance/ingest/ingestPunches", async () => {
    // B naming A's person directly places nothing.
    await ingestPunches(b.companyId, { kind: "app", siteId: b.site.id }, [
      {
        line: 1,
        raw: [],
        badge: null,
        personId: a.person.id,
        at: new Date("2026-11-05T15:00:00Z"),
        kind: "in",
      },
    ]);

    expect(
      (await attendanceOf(a.person.id)).map((row) => row.dedupeKey),
    ).not.toContain("attendance:2026-11-05");

    // B cannot file a batch under A's checador.
    await expect(
      ingestPunches(
        b.companyId,
        { kind: "batch", source: "csv", deviceId: deviceA, siteId: null },
        [],
      ),
    ).rejects.toThrow();
  });

  it("lib:attendance/listAttendanceBatches", async () => {
    expect((await listAttendanceBatches(b.companyId)).items).toEqual([]);
    expect(
      (await listAttendanceBatches(a.companyId)).items.length,
    ).toBeGreaterThan(0);
  });

  it("lib:attendance/listOpenUnmatched", async () => {
    expect((await listOpenUnmatched(b.companyId)).items).toEqual([]);
  });

  it("lib:attendance/countOpenUnmatched", async () => {
    expect(await countOpenUnmatched(b.companyId)).toBe(0);
    expect(await countOpenUnmatched(a.companyId)).toBeGreaterThan(0);
  });

  it("lib:attendance/assignBadge", async () => {
    expect(
      await assignBadge(
        b.companyId,
        { badge: "4242", personId: a.person.id },
        b.admin.id,
      ),
    ).toEqual({ ok: false, error: ATTENDANCE_COPY.personMissing });
    // A number of A is free in B: numbers are per company.
    expect(
      await assignBadge(
        b.companyId,
        { badge: "101", personId: b.teammate.id },
        b.admin.id,
      ),
    ).toEqual({ ok: true, placed: 0 });
    expect(
      await assignBadge(
        a.companyId,
        { badge: "101", personId: a.teammate.id },
        a.admin.id,
      ),
    ).toMatchObject({ ok: false });
  });

  it("lib:attendance/listBadges", async () => {
    const inB = await listBadges(b.companyId);

    expect(inB.items.map((row) => row.personId)).not.toContain(a.person.id);
    expect(
      (await listBadges(a.companyId)).items.map((row) => row.badge),
    ).toEqual(["101", "777"]);
  });

  it("lib:attendance/removeBadge", async () => {
    const [badgeA] = await ownerDb
      .select()
      .from(attendanceBadges)
      .where(
        and(
          eq(attendanceBadges.companyId, a.companyId),
          eq(attendanceBadges.badge, "777"),
        ),
      );

    expect(await removeBadge(b.companyId, badgeA.id, b.admin.id)).toMatchObject(
      { ok: false },
    );
    expect(await removeBadge(a.companyId, badgeA.id, a.admin.id)).toEqual({
      ok: true,
    });
    // The punches it placed stay.
    expect(await attendanceOf(a.teammate.id)).toHaveLength(1);
  });

  it("lib:attendance/dismissUnmatched", async () => {
    const [row] = (await listOpenUnmatched(a.companyId)).items;

    expect(await dismissUnmatched(b.companyId, row.id, b.admin.id)).toEqual({
      ok: false,
      error: ATTENDANCE_COPY.rowMissing,
    });
    expect(await dismissUnmatched(a.companyId, row.id, a.admin.id)).toEqual({
      ok: true,
    });
    expect(
      (await listOpenUnmatched(a.companyId)).items.map((item) => item.id),
    ).not.toContain(row.id);
  });

  it("lib:attendance/listCheckinSites", async () => {
    const inB = await listCheckinSites(b.companyId);

    expect(inB.map((row) => row.siteId)).not.toContain(a.site.id);
    expect(
      (await listCheckinSites(a.companyId)).find(
        (row) => row.siteId === a.site.id,
      ),
    ).toMatchObject({ radiusMeters: 150, enabled: true });
  });

  it("lib:attendance/saveCheckinSite", async () => {
    expect(
      await saveCheckinSite(
        b.companyId,
        {
          siteId: a.site.id,
          ...SITE_A,
          radiusMeters: 2000,
          qrMode: "printed",
          enabled: true,
        },
        b.admin.id,
      ),
    ).toEqual({ ok: false, error: ATTENDANCE_COPY.siteMissing });
  });

  it("lib:attendance/rotateCheckinSecret", async () => {
    const [before] = await ownerDb
      .select()
      .from(attendanceCheckinSites)
      .where(eq(attendanceCheckinSites.siteId, a.site.id));

    expect(
      await rotateCheckinSecret(b.companyId, a.site.id, b.admin.id),
    ).toMatchObject({
      ok: false,
    });

    const [after] = await ownerDb
      .select()
      .from(attendanceCheckinSites)
      .where(eq(attendanceCheckinSites.siteId, a.site.id));

    expect(after.qrSecret).toBe(before.qrSecret);
  });

  it("lib:attendance/checkin/checkinSiteFor", async () => {
    expect(await checkinSiteFor(b.companyId, a.site.id)).toBeNull();
    expect(await checkinSiteFor(a.companyId, a.site.id)).toMatchObject({
      siteId: a.site.id,
    });
  });
});

describe("acceptance: app check-in", () => {
  const contextA = () => ({
    accountId: a.person.id,
    companyId: a.companyId,
    personId: a.person.id,
    sessionId: a.person.id,
  });

  it("needs a genuine, current code and a phone inside the site", async () => {
    const site = (await checkinSiteFor(a.companyId, a.site.id))!;
    const now = new Date("2026-11-06T14:00:00Z");
    const code = qrCodeFor(site, now);

    expect(
      await checkIn(
        contextA(),
        { code: { ...code, mac: "A".repeat(22) }, kind: "in", ...NEAR_A },
        now,
      ),
    ).toEqual({ ok: false, error: CHECKIN_COPY.invalidCode });
    expect(
      await checkIn(
        contextA(),
        { code, kind: "in", ...NEAR_A },
        new Date(now.getTime() + 10 * 60_000),
      ),
    ).toEqual({ ok: false, error: CHECKIN_COPY.expiredCode });
    expect(
      await checkIn(contextA(), { code, kind: "in", ...FAR_A }, now),
    ).toMatchObject({
      ok: false,
    });
    expect(
      await checkIn(
        contextA(),
        { code, kind: "in", ...NEAR_A, accuracy: 500 },
        now,
      ),
    ).toEqual({ ok: false, error: CHECKIN_COPY.accuracy });

    expect(
      await checkIn(contextA(), { code, kind: "in", ...NEAR_A }, now),
    ).toEqual({
      ok: true,
      message: CHECKIN_COPY.done("in", "08:00"),
    });
    expect(
      await checkIn(
        contextA(),
        { code, kind: "in", ...NEAR_A },
        new Date(now.getTime() + 30_000),
      ),
    ).toEqual({ ok: false, error: CHECKIN_COPY.repeated });

    const day = (await attendanceOf(a.person.id)).find(
      (row) => row.dedupeKey === "attendance:2026-11-06",
    );

    expect(day?.source).toBe("app");
    expect(day?.payload).toEqual({
      site_id: a.site.id,
      punches: [["2026-11-06T14:00:00Z", "in", "app"]],
    });
  });

  it("refuses B's employee with A's code", async () => {
    const site = (await checkinSiteFor(a.companyId, a.site.id))!;
    const now = new Date();

    expect(
      await checkIn(
        {
          accountId: b.person.id,
          companyId: b.companyId,
          personId: b.person.id,
          sessionId: "x",
        },
        { code: qrCodeFor(site, now), kind: "in", ...NEAR_A },
        now,
      ),
    ).toEqual({ ok: false, error: CHECKIN_COPY.invalidCode });
  });

  it("action:attendance/checkInAction", async () => {
    const site = (await checkinSiteFor(a.companyId, a.site.id))!;
    const code = qrCodeFor(site);

    employee.context = null;
    expect(
      await checkInAction({ ...code, kind: "out", ...NEAR_A }),
    ).toMatchObject({ ok: false });

    // B's employee: the person comes from B's session, A's code does not open.
    employee.context = {
      accountId: b.person.id,
      companyId: b.companyId,
      personId: b.person.id,
      sessionId: "s",
    };
    expect(await checkInAction({ ...code, kind: "out", ...NEAR_A })).toEqual({
      ok: false,
      error: CHECKIN_COPY.invalidCode,
    });

    employee.context = { ...contextA(), accountId: a.teammate.id };
    expect(
      await checkInAction({ ...code, kind: "out", ...NEAR_A }),
    ).toMatchObject({ ok: true });
    employee.context = null;
  });
});

describe("attendance actions with company B's session", () => {
  const stale = { companyId: "" };

  beforeAll(() => {
    stale.companyId = a.companyId;
  });

  it("action:attendance/saveAttendanceDeviceAction", async () => {
    const before = await devicesOf(a.companyId);

    actAs(b.admin);
    expect(
      await saveAttendanceDeviceAction(
        {},
        formData({
          ...stale,
          name: "Nuevo",
          badgeColumn: "1",
          dateTimeColumn: "2",
          headerRows: "1",
          dateFormat: "YYYY-MM-DD",
        }),
      ),
    ).toEqual({ error: STALE_COMPANY_MESSAGE });
    expect(
      await saveAttendanceDeviceAction(
        {},
        formData({
          deviceId: deviceA,
          name: "Robado",
          badgeColumn: "1",
          dateTimeColumn: "2",
          headerRows: "1",
          dateFormat: "YYYY-MM-DD",
        }),
      ),
    ).toEqual({ error: ATTENDANCE_COPY.deviceMissing });
    expect(await devicesOf(a.companyId)).toEqual(before);
  });

  it("action:attendance/issueDeviceTokenAction", async () => {
    actAs(b.admin);
    expect(
      await issueDeviceTokenAction({}, formData({ deviceId: deviceA })),
    ).toEqual({
      error: ATTENDANCE_COPY.deviceMissing,
    });
  });

  it("action:attendance/setAttendanceDeviceActiveAction", async () => {
    actAs(b.admin);
    expect(
      await setAttendanceDeviceActiveAction(
        {},
        formData({ deviceId: deviceA, active: "false" }),
      ),
    ).toEqual({ error: ATTENDANCE_COPY.deviceMissing });
  });

  it("action:attendance/importChecadorCsvAction", async () => {
    actAs(b.admin);
    expect(
      await importChecadorCsvAction(
        {},
        formData({
          deviceId: deviceA,
          file: new File([EXPORT_A], "a.csv", { type: "text/csv" }),
        }),
      ),
    ).toEqual({ error: ATTENDANCE_COPY.deviceMissing });
  });

  it("action:attendance/assignBadgeAction", async () => {
    actAs(b.admin);
    expect(
      await assignBadgeAction(
        {},
        formData({ badge: "31337", personId: a.person.id }),
      ),
    ).toEqual({ error: ATTENDANCE_COPY.personMissing });
  });

  it("action:attendance/removeBadgeAction", async () => {
    const [badgeA] = await ownerDb
      .select()
      .from(attendanceBadges)
      .where(eq(attendanceBadges.companyId, a.companyId));

    actAs(b.admin);
    expect(
      await removeBadgeAction({}, formData({ badgeId: badgeA.id })),
    ).toMatchObject({
      error: expect.any(String),
    });
    expect(
      await ownerDb
        .select()
        .from(attendanceBadges)
        .where(eq(attendanceBadges.id, badgeA.id)),
    ).toHaveLength(1);
  });

  it("action:attendance/dismissUnmatchedAction", async () => {
    const [row] = await ownerDb
      .select()
      .from(attendanceUnmatched)
      .where(eq(attendanceUnmatched.companyId, a.companyId));

    actAs(b.admin);
    expect(
      await dismissUnmatchedAction({}, formData({ unmatchedId: row.id })),
    ).toEqual({
      error: ATTENDANCE_COPY.rowMissing,
    });
  });

  it("action:attendance/saveCheckinSiteAction", async () => {
    actAs(b.admin);
    expect(
      await saveCheckinSiteAction(
        {},
        formData({
          siteId: a.site.id,
          latitude: "19",
          longitude: "-99",
          radiusMeters: "100",
        }),
      ),
    ).toEqual({ error: ATTENDANCE_COPY.siteMissing });
  });

  it("action:attendance/rotateCheckinSecretAction", async () => {
    actAs(b.admin);
    expect(
      await rotateCheckinSecretAction({}, formData({ siteId: a.site.id })),
    ).toMatchObject({
      error: expect.any(String),
    });
  });

  it("action:attendance/kioskCodeAction", async () => {
    actAs(b.admin);
    expect(await kioskCodeAction(a.site.id)).toBeNull();
    actAs(a.admin);
    expect(await kioskCodeAction(a.site.id)).toMatchObject({
      url: expect.stringContaining("https://workia.test/mi/checar?s="),
      svg: expect.stringContaining("<svg"),
    });
  });

  it("action:attendance/searchAttendancePeopleAction", async () => {
    actAs(b.admin);
    expect(
      (await searchAttendancePeopleAction("Persona")).map((row) => row.id),
    ).not.toContain(a.person.id);
  });
});

describe("attendance actions need attendance:manage", () => {
  const deniedFor = async (run: () => Promise<unknown>) => {
    for (const user of [a.viewer, a.editor]) {
      actAs(user);
      expect(await run()).toEqual({ error: ATTENDANCE_COPY.denied });
    }
  };

  it("rbac:action:attendance/saveAttendanceDeviceAction", async () => {
    const form = () =>
      formData({
        name: "Checador RBAC",
        badgeColumn: "1",
        dateTimeColumn: "2",
        headerRows: "1",
        dateFormat: "YYYY-MM-DD",
      });

    await deniedFor(() => saveAttendanceDeviceAction({}, form()));
    actAs(a.admin);
    expect(await saveAttendanceDeviceAction({}, form())).toMatchObject({
      ok: true,
    });
  });

  it("rbac:action:attendance/issueDeviceTokenAction", async () => {
    await deniedFor(() =>
      issueDeviceTokenAction({}, formData({ deviceId: deviceA })),
    );
    actAs(a.admin);
    const issued = await issueDeviceTokenAction(
      {},
      formData({ deviceId: deviceA }),
    );

    expect(issued.token).toMatch(/^wkc_/);
    // The old token stopped working.
    expect(
      (
        await push(tokenA, {
          punches: [{ badge: "1", at: "2026-11-04 10:00" }],
        })
      ).status,
    ).toBe(401);
    tokenA = issued.token!;
  });

  it("rbac:action:attendance/setAttendanceDeviceActiveAction", async () => {
    await deniedFor(() =>
      setAttendanceDeviceActiveAction(
        {},
        formData({ deviceId: deviceA, active: "false" }),
      ),
    );
    actAs(a.admin);
    expect(
      await setAttendanceDeviceActiveAction(
        {},
        formData({ deviceId: deviceA, active: "false" }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      (
        await push(tokenA, {
          punches: [{ badge: "1", at: "2026-11-04 10:00" }],
        })
      ).status,
    ).toBe(401);
    expect(
      await setAttendanceDeviceActiveAction(
        {},
        formData({ deviceId: deviceA, active: "true" }),
      ),
    ).toMatchObject({ ok: true });
  });

  it("rbac:action:attendance/importChecadorCsvAction", async () => {
    const form = () =>
      formData({
        deviceId: deviceA,
        file: new File([EXPORT_A], "a.csv", { type: "text/csv" }),
      });

    await deniedFor(() => importChecadorCsvAction({}, form()));
    actAs(a.admin);
    expect(await importChecadorCsvAction({}, form())).toMatchObject({
      ok: true,
      summary: { punchesAdded: 0 },
    });
  });

  it("rbac:action:attendance/assignBadgeAction", async () => {
    await deniedFor(() =>
      assignBadgeAction(
        {},
        formData({ badge: "202", personId: a.teammate.id }),
      ),
    );
  });

  it("rbac:action:attendance/removeBadgeAction", async () => {
    const [badgeA] = await ownerDb
      .select()
      .from(attendanceBadges)
      .where(eq(attendanceBadges.companyId, a.companyId));

    await deniedFor(() =>
      removeBadgeAction({}, formData({ badgeId: badgeA.id })),
    );
  });

  it("rbac:action:attendance/dismissUnmatchedAction", async () => {
    const [row] = await ownerDb
      .select()
      .from(attendanceUnmatched)
      .where(eq(attendanceUnmatched.companyId, a.companyId));

    await deniedFor(() =>
      dismissUnmatchedAction({}, formData({ unmatchedId: row.id })),
    );
  });

  it("rbac:action:attendance/saveCheckinSiteAction", async () => {
    await deniedFor(() =>
      saveCheckinSiteAction(
        {},
        formData({
          siteId: a.site.id,
          latitude: "19",
          longitude: "-99",
          radiusMeters: "100",
        }),
      ),
    );
  });

  it("rbac:action:attendance/rotateCheckinSecretAction", async () => {
    await deniedFor(() =>
      rotateCheckinSecretAction({}, formData({ siteId: a.site.id })),
    );
    actAs(a.admin);
    expect(
      await rotateCheckinSecretAction({}, formData({ siteId: a.site.id })),
    ).toMatchObject({
      ok: true,
    });
  });

  it("rbac:action:attendance/kioskCodeAction", async () => {
    for (const user of [a.viewer, a.editor]) {
      actAs(user);
      expect(await kioskCodeAction(a.site.id)).toBeNull();
    }
  });

  it("rbac:action:attendance/searchAttendancePeopleAction", async () => {
    actAs(a.viewer);
    expect(await searchAttendancePeopleAction("Persona")).toEqual([]);
    actAs(a.admin);
    expect(
      (await searchAttendancePeopleAction("Persona")).length,
    ).toBeGreaterThan(0);
  });

  it("leaves an audit event for each HR change", async () => {
    const events = await ownerDb
      .select({
        resourceType: auditEvents.resourceType,
        action: auditEvents.action,
      })
      .from(auditEvents)
      .where(eq(auditEvents.companyId, a.companyId));
    const kinds = new Set(
      events.map((event) => `${event.resourceType}:${event.action}`),
    );

    for (const kind of [
      "attendance_device:create",
      "attendance_device:activation_code",
      "attendance_device:deactivate",
      "attendance_import:import",
      "attendance_import:reject",
      "attendance_badge:link",
      "attendance_badge:unlink",
      "attendance_checkin:update",
      "attendance_checkin:revoke",
    ]) {
      expect(kinds, kind).toContain(kind);
    }
  });
});
