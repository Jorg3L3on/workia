/**
 * The incidencias engine (Workia 2.0 W2-14) against the database: it turns
 * stored punches and the schedule into incidencias, recomputes after an
 * ingestion, refuses closed quincenas, and every HR decision (rules,
 * permisos, overrides, cancels) leaves an audit event. Company B can neither
 * read nor change company A's rules, justifications or incidencias. Titles
 * are the surface ids in docs/idor-matrix.md.
 */
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import {
  ingestPunches,
  recomputeIncidenciasAfter,
} from "@/lib/attendance/ingest";
import {
  auditEvents,
  incidenciaJustifications,
  incidenciaRules,
  personEvents,
  personSchedules,
} from "@/lib/db/schema";
import {
  cancelJustification,
  createJustification,
  getIncidenciaRules,
  getPersonPeriodIncidencias,
  IncidenciaError,
  listIncidenciaRules,
  listJustifications,
  overrideIncidencia,
  recomputeAfterAttendance,
  runIncidencias,
  saveIncidenciaRules,
} from "@/lib/incidencias";
import {
  cancelJustificationAction,
  createJustificationAction,
  overrideIncidenciaAction,
  recomputePayPeriodAction,
  saveIncidenciaRulesAction,
} from "@/lib/incidencias/actions";
import { INCIDENCIAS_COPY } from "@/lib/incidencias/copy";
import {
  closePayPeriod,
  PayPeriodError,
  reopenPayPeriod,
} from "@/lib/pay-periods";
import { STALE_COMPANY_MESSAGE } from "@/lib/tenant/scope";
import { writeAttendanceDays } from "@/lib/timeline/writers";

import { ownerDb, seedTenant, type Tenant } from "./fixtures";
import { actAs } from "./session-state";

const formData = (values: Record<string, string>) => {
  const data = new FormData();

  for (const [key, value] of Object.entries(values)) data.set(key, value);

  return data;
};

let a: Tenant;
let b: Tenant;

// October 2026, first quincena: Thursday 1 to Thursday 15.
const Q = "2026-10-Q1";
const AS_OF = new Date("2026-11-01T00:00:00Z");

const at = (day: string, time: string) =>
  new Date(`${day}T${time}:00-06:00`).toISOString();

const punchDay = (
  personId: string,
  day: string,
  entry: string,
  exit: string,
) => ({
  personId,
  day,
  source: "checador",
  punches: [
    { at: at(day, entry), kind: "in" as const },
    { at: at(day, exit), kind: "out" as const },
  ],
});

const incidenciasOf = async (personId: string, period = Q) =>
  (
    await ownerDb
      .select({ payload: personEvents.payload })
      .from(personEvents)
      .where(
        and(
          eq(personEvents.personId, personId),
          eq(personEvents.type, "incidencia"),
        ),
      )
  )
    .map((row) => row.payload as Record<string, unknown>)
    .filter((payload) => payload.period === period)
    .sort((x, y) => `${x.date}${x.kind}`.localeCompare(`${y.date}${y.kind}`));

const onDay = async (personId: string, day: string, period = Q) =>
  (await incidenciasOf(personId, period)).filter((row) => row.date === day);

const auditsOf = (companyId: string, action: string) =>
  ownerDb
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.companyId, companyId),
        eq(auditEvents.resourceType, "incidencia_justification"),
        eq(auditEvents.action, action as "override"),
      ),
    );

/** Monday to Friday, 08:00 to 17:00. */
const giveDayShift = (personId: string) =>
  ownerDb
    .update(personSchedules)
    .set({
      entrada: "08:00",
      salida: "17:00",
      blocks: [
        {
          dias: ["lun", "mar", "mie", "jue", "vie"],
          entrada: "08:00",
          salida: "17:00",
          comidaInicio: null,
          comidaFin: null,
        },
      ],
    })
    .where(eq(personSchedules.personId, personId));

beforeAll(async () => {
  a = await seedTenant("INA");
  b = await seedTenant("INB");
  await giveDayShift(a.person.id);
  await giveDayShift(b.person.id);
  await writeAttendanceDays(a.companyId, [
    punchDay(a.person.id, "2026-10-05", "07:55", "17:05"),
    punchDay(a.person.id, "2026-10-06", "08:30", "17:00"),
    punchDay(a.person.id, "2026-10-08", "08:00", "16:00"),
  ]);
});

describe("lib:incidencias/runIncidencias", () => {
  it("turns punches and the schedule into incidencias, only for the company's people", async () => {
    const result = await runIncidencias(a.companyId, Q, { asOf: AS_OF });

    expect(result.period).toBe(Q);
    expect(await onDay(a.person.id, "2026-10-05")).toEqual([]);
    expect(await onDay(a.person.id, "2026-10-06")).toEqual([
      expect.objectContaining({
        kind: "retardo",
        minutes: 30,
        justified: false,
      }),
    ]);
    expect(await onDay(a.person.id, "2026-10-07")).toEqual([
      expect.objectContaining({ kind: "falta", justified: false }),
    ]);
    expect(await onDay(a.person.id, "2026-10-08")).toEqual([
      expect.objectContaining({ kind: "salida_anticipada", minutes: 60 }),
    ]);
    // Saturday and Sunday are not in the schedule.
    expect(await onDay(a.person.id, "2026-10-10")).toEqual([]);
    // The teammate has no schedule: nothing to compare against.
    expect(await incidenciasOf(a.teammate.id)).toEqual([]);

    // A second run writes nothing new.
    const again = await runIncidencias(a.companyId, Q, { asOf: AS_OF });
    expect(again.inserted).toBe(0);
    expect(again.deleted).toBe(0);
  });

  it("from company B, computes nobody of company A", async () => {
    const before = await incidenciasOf(a.person.id);
    const result = await runIncidencias(b.companyId, Q, {
      personIds: [a.person.id],
      asOf: AS_OF,
    });

    expect(result.people).toBe(0);
    expect(await incidenciasOf(a.person.id)).toEqual(before);
  });

  it("refuses a closed quincena and writes nothing", async () => {
    const period = "2026-09-Q2";

    await runIncidencias(a.companyId, period, { asOf: AS_OF });
    await closePayPeriod(a.companyId, period, { actorUserId: a.admin.id });
    const before = await incidenciasOf(a.person.id, period);

    await ownerDb
      .delete(personEvents)
      .where(
        and(
          eq(personEvents.personId, a.person.id),
          eq(personEvents.dedupeKey, "attendance:2026-09-16"),
        ),
      );
    await writeAttendanceDays(a.companyId, [
      punchDay(a.person.id, "2026-09-16", "08:00", "17:00"),
    ]);
    await expect(
      runIncidencias(a.companyId, period, { asOf: AS_OF }),
    ).rejects.toMatchObject({ code: "period_closed" });
    expect(await incidenciasOf(a.person.id, period)).toEqual(before);

    await reopenPayPeriod(a.companyId, period, {
      reason: "Llegaron checadas",
      actorUserId: a.admin.id,
    });
    await runIncidencias(a.companyId, period, { asOf: AS_OF });
    expect(await onDay(a.person.id, "2026-09-16", period)).toEqual([]);
  });
});

describe("lib:incidencias/recomputeAfterAttendance", () => {
  it("recomputes the touched people and skips closed quincenas", async () => {
    const period = "2026-08-Q1";

    await closePayPeriod(a.companyId, period, { actorUserId: a.admin.id });
    const computed = await recomputeAfterAttendance(
      a.companyId,
      [
        { personId: a.person.id, day: "2026-08-04" },
        { personId: a.person.id, day: "2026-10-06" },
      ],
      { asOf: AS_OF },
    );

    expect(computed).toEqual([Q]);
    expect(await incidenciasOf(a.person.id, period)).toEqual([]);
  });

  it("from company B, touches nothing of company A", async () => {
    const before = await incidenciasOf(a.person.id);

    await recomputeAfterAttendance(
      b.companyId,
      [{ personId: a.person.id, day: "2026-10-09" }],
      { asOf: AS_OF },
    );
    expect(await incidenciasOf(a.person.id)).toEqual(before);
  });
});

describe("lib:attendance/ingest/recomputeIncidenciasAfter", () => {
  it("an ingestion recomputes the day's incidencias once it commits", async () => {
    expect(await onDay(a.person.id, "2026-10-09")).toEqual([
      expect.objectContaining({ kind: "falta" }),
    ]);

    await ingestPunches(a.companyId, { kind: "app", siteId: a.site.id }, [
      {
        line: 1,
        raw: [],
        badge: null,
        personId: a.person.id,
        at: new Date(at("2026-10-09", "08:20")),
        kind: "in",
      },
      {
        line: 2,
        raw: [],
        badge: null,
        personId: a.person.id,
        at: new Date(at("2026-10-09", "17:00")),
        kind: "out",
      },
    ]);

    expect(await onDay(a.person.id, "2026-10-09")).toEqual([
      expect.objectContaining({ kind: "retardo", minutes: 20 }),
    ]);
  });

  it("from company B, recomputes nothing of company A", async () => {
    const before = await incidenciasOf(a.person.id);

    await recomputeIncidenciasAfter(
      b.companyId,
      [{ personId: a.person.id, day: "2026-10-12" }],
      AS_OF,
    );
    expect(await incidenciasOf(a.person.id)).toEqual(before);
  });
});

describe("lib:incidencias/createJustification", () => {
  it("a permiso justifies the faltas of its days, with an audit event", async () => {
    const row = await createJustification(
      a.companyId,
      {
        personId: a.person.id,
        kind: "permiso_con_goce",
        fromDay: "2026-10-07",
        toDay: "2026-10-07",
        reason: "Trámite personal",
      },
      { actorUserId: a.admin.id, asOf: AS_OF },
    );

    expect(await onDay(a.person.id, "2026-10-07")).toEqual([
      expect.objectContaining({
        kind: "falta",
        justified: true,
        justification_ref: `permiso_con_goce:${row.id}`,
        rev: 1,
      }),
    ]);
    expect(
      (await auditsOf(a.companyId, "create")).map((event) => event.resourceId),
    ).toContain(row.id);
  });

  it("refuses company A's person from company B, and a closed quincena", async () => {
    await expect(
      createJustification(b.companyId, {
        personId: a.person.id,
        kind: "incapacidad_imss",
        fromDay: "2026-10-12",
        toDay: "2026-10-13",
        reason: "Intento",
      }),
    ).rejects.toBeInstanceOf(IncidenciaError);
    await expect(
      createJustification(a.companyId, {
        personId: a.person.id,
        kind: "incapacidad_imss",
        fromDay: "2026-08-03",
        toDay: "2026-08-04",
        reason: "Cerrada",
      }),
    ).rejects.toBeInstanceOf(PayPeriodError);
    expect(
      await ownerDb
        .select()
        .from(incidenciaJustifications)
        .where(eq(incidenciaJustifications.companyId, b.companyId)),
    ).toEqual([]);
  });
});

describe("lib:incidencias/overrideIncidencia", () => {
  it("HR voids one incidencia with a reason and it leaves an audit event", async () => {
    const row = await overrideIncidencia(
      a.companyId,
      {
        personId: a.person.id,
        day: "2026-10-08",
        kind: "salida_anticipada",
        effect: "void",
        reason: "Salió con permiso verbal del jefe",
      },
      { actorUserId: a.admin.id, asOf: AS_OF },
    );

    expect(await onDay(a.person.id, "2026-10-08")).toEqual([
      expect.objectContaining({
        kind: "salida_anticipada",
        voided: true,
        justification_ref: `override:${row.id}`,
      }),
    ]);
    const [audit] = (await auditsOf(a.companyId, "override")).filter(
      (event) => event.resourceId === row.id,
    );
    expect(audit).toMatchObject({ actorUserId: a.admin.id });
    expect(JSON.stringify(audit.payload)).toContain("permiso verbal");
  });

  it("refuses company A's person from company B and a missing reason", async () => {
    await expect(
      overrideIncidencia(b.companyId, {
        personId: a.person.id,
        day: "2026-10-06",
        kind: "retardo",
        effect: "justify",
        reason: "Intento",
      }),
    ).rejects.toBeInstanceOf(IncidenciaError);
    await expect(
      overrideIncidencia(a.companyId, {
        personId: a.person.id,
        day: "2026-10-06",
        kind: "retardo",
        effect: "justify",
        reason: " ",
      }),
    ).rejects.toMatchObject({ code: "reason_required" });
    expect(await onDay(a.person.id, "2026-10-06")).toEqual([
      expect.objectContaining({ kind: "retardo", justified: false }),
    ]);
  });
});

describe("lib:incidencias/cancelJustification", () => {
  it("company B cannot cancel company A's justification; A can, and the day is recomputed", async () => {
    const [permiso] = await listJustifications(a.companyId, a.person.id, {
      from: "2026-10-01",
      to: "2026-10-15",
    });

    await expect(
      cancelJustification(b.companyId, permiso.id, { reason: "Intento" }),
    ).rejects.toMatchObject({ code: "not_found" });
    await cancelJustification(a.companyId, permiso.id, {
      reason: "Capturado por error",
      actorUserId: a.admin.id,
      asOf: AS_OF,
    });
    expect(await onDay(a.person.id, "2026-10-07")).toEqual([
      expect.objectContaining({ kind: "falta", justified: false, rev: 2 }),
    ]);
    expect(
      (await auditsOf(a.companyId, "revoke")).map((event) => event.resourceId),
    ).toContain(permiso.id);
  });
});

describe("lib:incidencias/listJustifications", () => {
  it("gives company B none of company A's justifications", async () => {
    expect(
      await listJustifications(b.companyId, a.person.id, {
        from: "2026-10-01",
        to: "2026-10-15",
      }),
    ).toEqual([]);
  });
});

describe("lib:incidencias/getPersonPeriodIncidencias", () => {
  it("reads one person's quincena, and nothing across companies", async () => {
    const detail = await getPersonPeriodIncidencias(
      a.companyId,
      Q,
      a.person.id,
    );

    expect(
      detail?.incidencias.map((row) => [row.day, row.kind]),
    ).toContainEqual(["2026-10-06", "retardo"]);
    expect(detail?.punches["2026-10-06"]?.first).toBe(
      at("2026-10-06", "08:30").replace(".000", ""),
    );
    expect(
      await getPersonPeriodIncidencias(b.companyId, Q, a.person.id),
    ).toBeNull();
  });
});

describe("incidencia rules", () => {
  it("lib:incidencias/saveIncidenciaRules", async () => {
    const saved = await saveIncidenciaRules(
      a.companyId,
      {
        retardoToleranceMinutes: 5,
        salidaToleranceMinutes: 0,
        faltaAfterMinutes: 60,
      },
      { actorUserId: a.admin.id, today: "2026-10-20" },
    );

    // A change starts in the next quincena: 2026-10-Q2 keeps the defaults.
    expect(saved.effectivePeriod).toBe("2026-11-Q1");
    await expect(
      saveIncidenciaRules(a.companyId, {
        retardoToleranceMinutes: 5,
        salidaToleranceMinutes: 0,
        faltaAfterMinutes: 3,
      }),
    ).rejects.toMatchObject({ code: "invalid_rules" });
    expect(
      await ownerDb
        .select()
        .from(incidenciaRules)
        .where(eq(incidenciaRules.companyId, b.companyId)),
    ).toEqual([]);
    const [audit] = await ownerDb
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.companyId, a.companyId),
          eq(auditEvents.resourceType, "incidencia_rules"),
        ),
      );
    expect(audit).toMatchObject({ action: "update", resourceId: "2026-11-Q1" });
  });

  it("lib:incidencias/getIncidenciaRules", async () => {
    expect(await getIncidenciaRules(a.companyId, "2026-10-Q2")).toMatchObject({
      retardoToleranceMinutes: 10,
      effectivePeriod: null,
    });
    expect(await getIncidenciaRules(a.companyId, "2026-12-Q1")).toMatchObject({
      retardoToleranceMinutes: 5,
      faltaAfterMinutes: 60,
    });
    // Company B still has the defaults.
    expect(await getIncidenciaRules(b.companyId, "2026-12-Q1")).toMatchObject({
      retardoToleranceMinutes: 10,
      effectivePeriod: null,
    });
  });

  it("lib:incidencias/listIncidenciaRules", async () => {
    expect(await listIncidenciaRules(a.companyId)).toHaveLength(1);
    expect(await listIncidenciaRules(b.companyId)).toEqual([]);
  });
});

describe("incidencias actions across companies", () => {
  it("action:incidencias/saveIncidenciaRulesAction", async () => {
    actAs(b.admin);
    expect(
      await saveIncidenciaRulesAction(
        {},
        formData({
          companyId: a.companyId,
          retardoToleranceMinutes: "0",
          salidaToleranceMinutes: "0",
        }),
      ),
    ).toEqual({ error: STALE_COMPANY_MESSAGE });
    expect(await listIncidenciaRules(a.companyId)).toHaveLength(1);
    expect(
      await saveIncidenciaRulesAction(
        {},
        formData({ retardoToleranceMinutes: "", salidaToleranceMinutes: "0" }),
      ),
    ).toEqual({ error: expect.stringContaining("tolerancia de entrada") });
  });

  it("action:incidencias/recomputePayPeriodAction", async () => {
    actAs(b.admin);
    expect(
      await recomputePayPeriodAction(
        {},
        formData({ companyId: a.companyId, period: Q }),
      ),
    ).toEqual({ error: STALE_COMPANY_MESSAGE });
    expect(
      await recomputePayPeriodAction({}, formData({ period: "2026-10-1" })),
    ).toEqual({ error: INCIDENCIAS_COPY.invalidPeriod });
    expect(
      await recomputePayPeriodAction({}, formData({ period: Q })),
    ).toMatchObject({ ok: true });
  });

  it("action:incidencias/createJustificationAction", async () => {
    actAs(b.admin);
    const values = {
      personId: a.person.id,
      kind: "permiso_sin_goce",
      fromDay: "2026-10-12",
      reason: "Intento",
    };

    expect(
      await createJustificationAction(
        {},
        formData({ companyId: a.companyId, ...values }),
      ),
    ).toEqual({ error: STALE_COMPANY_MESSAGE });
    expect(await createJustificationAction({}, formData(values))).toEqual({
      error: "Esa persona no existe.",
    });
  });

  it("action:incidencias/overrideIncidenciaAction", async () => {
    actAs(b.admin);
    const values = {
      personId: a.person.id,
      day: "2026-10-06",
      kind: "retardo",
      effect: "justify",
      reason: "Intento",
    };

    expect(
      await overrideIncidenciaAction(
        {},
        formData({ companyId: a.companyId, ...values }),
      ),
    ).toEqual({ error: STALE_COMPANY_MESSAGE });
    expect(await overrideIncidenciaAction({}, formData(values))).toEqual({
      error: "Esa persona no existe.",
    });
    expect(await onDay(a.person.id, "2026-10-06")).toEqual([
      expect.objectContaining({ justified: false }),
    ]);
  });

  it("action:incidencias/cancelJustificationAction", async () => {
    const [override] = (
      await listJustifications(a.companyId, a.person.id, {
        from: "2026-10-08",
        to: "2026-10-08",
      })
    ).filter((row) => row.kind === "override");

    actAs(b.admin);
    expect(
      await cancelJustificationAction(
        {},
        formData({ companyId: a.companyId, id: override.id, reason: "x" }),
      ),
    ).toEqual({ error: STALE_COMPANY_MESSAGE });
    expect(
      await cancelJustificationAction(
        {},
        formData({ id: override.id, reason: "x" }),
      ),
    ).toEqual({ error: expect.stringContaining("no existe") });
  });
});

describe("incidencias permissions", () => {
  const denied = { error: INCIDENCIAS_COPY.denied };

  it("rbac:action:incidencias/saveIncidenciaRulesAction", async () => {
    for (const user of [a.viewer, a.editor]) {
      actAs(user);
      expect(
        await saveIncidenciaRulesAction(
          {},
          formData({
            retardoToleranceMinutes: "0",
            salidaToleranceMinutes: "0",
          }),
        ),
      ).toEqual(denied);
    }
  });

  it("rbac:action:incidencias/recomputePayPeriodAction", async () => {
    for (const user of [a.viewer, a.editor]) {
      actAs(user);
      expect(
        await recomputePayPeriodAction({}, formData({ period: Q })),
      ).toEqual(denied);
    }
  });

  it("rbac:action:incidencias/createJustificationAction", async () => {
    for (const user of [a.viewer, a.editor]) {
      actAs(user);
      expect(
        await createJustificationAction(
          {},
          formData({
            personId: a.person.id,
            kind: "permiso_con_goce",
            fromDay: "2026-10-12",
            reason: "Sin permiso",
          }),
        ),
      ).toEqual(denied);
    }
  });

  it("rbac:action:incidencias/overrideIncidenciaAction", async () => {
    for (const user of [a.viewer, a.editor]) {
      actAs(user);
      expect(
        await overrideIncidenciaAction(
          {},
          formData({
            personId: a.person.id,
            day: "2026-10-06",
            kind: "retardo",
            effect: "void",
            reason: "Sin permiso",
          }),
        ),
      ).toEqual(denied);
    }
  });

  it("rbac:action:incidencias/cancelJustificationAction", async () => {
    for (const user of [a.viewer, a.editor]) {
      actAs(user);
      expect(
        await cancelJustificationAction(
          {},
          formData({ id: a.person.id, reason: "Sin permiso" }),
        ),
      ).toEqual(denied);
    }

    // With the permission, the override is cancelled and the day recomputed.
    const [override] = (
      await listJustifications(a.companyId, a.person.id, {
        from: "2026-10-08",
        to: "2026-10-08",
      })
    ).filter((row) => row.kind === "override");

    actAs(a.admin);
    expect(
      await cancelJustificationAction(
        {},
        formData({ id: override.id, reason: "Revisado" }),
      ),
    ).toEqual({ ok: true, message: INCIDENCIAS_COPY.cancelled });
    const [restored] = await onDay(a.person.id, "2026-10-08");
    expect(restored).toMatchObject({ kind: "salida_anticipada", minutes: 60 });
    expect(restored.voided).toBeUndefined();
  });
});
