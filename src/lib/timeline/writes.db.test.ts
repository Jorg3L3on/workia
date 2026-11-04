/**
 * Timeline writes and backfill (Workia 2.0 W2-13) against a real database.
 * Every writer stores its event in the transaction of the change: when the
 * event cannot be written, the change rolls back too. A query by person
 * returns every type in time order; the attendance and incidencias writers
 * merge and replace without UPDATE; the backfill counts match the sources and
 * a second run inserts nothing.
 */
import { and, eq, like } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { decideContractRenewal } from "@/lib/contracts";
import { renewalDecisionSchema } from "@/lib/contracts/schema";
import { withTransaction } from "@/lib/db";
import {
  auditEvents,
  contracts,
  employmentPeriods,
  importRows,
  people,
  personDocuments,
  personEvents,
  positions,
  vacationRecords,
} from "@/lib/db/schema";
import { recordDelivery, setRequirements } from "@/lib/documents";
import { applyJobStep } from "@/lib/import/apply";
import {
  appendImportRows,
  createImportJob,
  finalizeImportUpload,
} from "@/lib/import/jobs";
import { validateJobStep } from "@/lib/import/validate";
import { createPerson, updatePerson } from "@/lib/people";
import {
  correctTermination,
  rehirePerson,
  terminatePerson,
} from "@/lib/people/employment";
import type { PersonFormValues } from "@/lib/people/schema";
import { listTerminationReasons } from "@/lib/termination-reasons";
import { registerVacationRecord, voidVacationRecord } from "@/lib/vacations";
import { uniqueCurp } from "@/test/curp";
import { ownerDb, seedTenant, type Tenant } from "@/test/idor/fixtures";

import { backfillPersonTimeline } from "./backfill";
import { receiptEvent } from "./events";
import {
  appendPersonEvents,
  listPersonEvents,
  PERSON_EVENT_TYPES,
} from "./index";
import {
  TimelineConflictError,
  readAttendance,
  replacePeriodIncidencias,
  writeAttendanceDays,
} from "./writers";

// Lets a test make the event write fail, to see the change roll back with it.
const failure = vi.hoisted(() => ({ on: false }));

vi.mock("./index", async (importOriginal) => {
  const real = await importOriginal<typeof import("./index")>();

  return {
    ...real,
    appendPersonEvents: (
      ...args: Parameters<typeof real.appendPersonEvents>
    ) =>
      failure.on
        ? Promise.reject(new Error("timeline write failed"))
        : real.appendPersonEvents(...args),
  };
});

afterEach(() => {
  failure.on = false;
});

let a: Tenant;
let reasonId: string;

const personForm = (
  overrides: Partial<PersonFormValues> = {},
): PersonFormValues => ({
  nombres: "Línea",
  apellidoPaterno: "Tiempo",
  apellidoMaterno: "",
  email: "",
  telefono: "",
  fechaNacimiento: "",
  fechaIngreso: "2022-01-10",
  areaId: "",
  positionId: "",
  managerId: "",
  siteId: "",
  rfc: "",
  curp: uniqueCurp(),
  nss: "",
  horarioEntrada: "",
  horarioSalidaComer: "",
  horarioRegresoComer: "",
  horarioSalida: "",
  status: "activa",
  ...overrides,
});

const eventsOf = (personId: string) =>
  ownerDb
    .select()
    .from(personEvents)
    .where(eq(personEvents.personId, personId))
    .orderBy(personEvents.occurredAt);

const eventByKey = async (personId: string, dedupeKey: string) =>
  (
    await ownerDb
      .select()
      .from(personEvents)
      .where(
        and(
          eq(personEvents.personId, personId),
          eq(personEvents.dedupeKey, dedupeKey),
        ),
      )
  )[0];

const periodsOf = (personId: string) =>
  ownerDb
    .select()
    .from(employmentPeriods)
    .where(eq(employmentPeriods.personId, personId))
    .orderBy(employmentPeriods.createdAt);

const newPerson = (overrides: Partial<PersonFormValues> = {}) =>
  createPerson(a.companyId, personForm(overrides), a.admin.id);

const baja = (fechaBaja = "2025-06-30") => ({
  fechaBaja,
  tipoBaja: "voluntaria" as const,
  motivoBajaId: reasonId,
  comentario: "",
  recontratable: true,
});

beforeAll(async () => {
  a = await seedTenant("TW");
  reasonId = (await listTerminationReasons(a.companyId))[0].id;
});

describe("employment events", () => {
  it("an alta writes the ingreso of its period, or nothing at all", async () => {
    const person = await newPerson({
      positionId: a.position.id,
      siteId: a.site.id,
    });
    const [period] = await periodsOf(person.id);
    const alta = await eventByKey(
      person.id,
      `employment:period:${period.id}:alta`,
    );

    expect(alta).toMatchObject({
      type: "employment",
      source: "app",
      occurredAt: new Date("2022-01-10T18:00:00Z"),
      payload: {
        kind: "alta",
        employment_period_id: period.id,
        date: "2022-01-10",
        position_id: a.position.id,
        site_id: a.site.id,
      },
    });

    failure.on = true;
    const curp = uniqueCurp();
    await expect(newPerson({ curp })).rejects.toThrow("timeline write failed");
    expect(
      await ownerDb.select().from(people).where(eq(people.curp, curp)),
    ).toEqual([]);
  });

  it("a new puesto is a «cambio» keyed by its audit event, and rolls back with it", async () => {
    const person = await newPerson();
    const [moved] = await ownerDb
      .insert(positions)
      .values({ companyId: a.companyId, name: `Puesto cambio ${person.id}` })
      .returning();

    failure.on = true;
    await expect(
      updatePerson(
        a.companyId,
        person.id,
        personForm({ curp: person.curp!, positionId: moved.id }),
        a.admin.id,
      ),
    ).rejects.toThrow("timeline write failed");
    expect(
      (await ownerDb.select().from(people).where(eq(people.id, person.id)))[0]
        .positionId,
    ).toBeNull();

    failure.on = false;
    await updatePerson(
      a.companyId,
      person.id,
      personForm({ curp: person.curp!, positionId: moved.id }),
      a.admin.id,
    );
    const [audit] = await ownerDb
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.resourceId, person.id),
          eq(auditEvents.action, "update"),
        ),
      );
    const cambio = await eventByKey(person.id, `employment:audit:${audit.id}`);

    expect(cambio?.payload).toEqual({
      kind: "cambio",
      position_id: moved.id,
      from_position_id: null,
    });
    expect(cambio?.occurredAt).toEqual(audit.occurredAt);

    // An edit that moves nothing writes no event.
    const before = (await eventsOf(person.id)).length;
    await updatePerson(
      a.companyId,
      person.id,
      personForm({
        curp: person.curp!,
        positionId: moved.id,
        telefono: "5555555555",
      }),
      a.admin.id,
    );
    expect(await eventsOf(person.id)).toHaveLength(before);
  });

  it("a baja writes the closing of its period, or the person stays activa", async () => {
    const person = await newPerson();

    failure.on = true;
    await expect(
      terminatePerson(a.companyId, person.id, baja(), a.admin.id),
    ).rejects.toThrow("timeline write failed");
    expect(
      (await ownerDb.select().from(people).where(eq(people.id, person.id)))[0]
        .status,
    ).toBe("activa");

    failure.on = false;
    const result = await terminatePerson(
      a.companyId,
      person.id,
      baja(),
      a.admin.id,
    );
    const event = await eventByKey(
      person.id,
      `employment:period:${result!.period.id}:baja`,
    );

    expect(event).toMatchObject({
      occurredAt: new Date("2025-06-30T18:00:00Z"),
      payload: {
        kind: "baja",
        date: "2025-06-30",
        tipo: "voluntaria",
        motivo_id: reasonId,
      },
    });
  });

  it("a reingreso writes the alta of the new period", async () => {
    const person = await newPerson();
    await terminatePerson(a.companyId, person.id, baja(), a.admin.id);

    failure.on = true;
    await expect(
      rehirePerson(
        a.companyId,
        person.id,
        { fechaIngreso: "2026-02-01", reconoceAntiguedad: false },
        a.admin.id,
      ),
    ).rejects.toThrow("timeline write failed");
    expect(await periodsOf(person.id)).toHaveLength(1);

    failure.on = false;
    const result = await rehirePerson(
      a.companyId,
      person.id,
      { fechaIngreso: "2026-02-01", reconoceAntiguedad: false },
      a.admin.id,
    );

    expect(
      (
        await eventByKey(
          person.id,
          `employment:period:${result!.period.id}:alta`,
        )
      )?.payload,
    ).toMatchObject({ kind: "alta", date: "2026-02-01" });
  });

  it("a baja «sin fecha» and its correction are two events", async () => {
    const person = await newPerson();
    await updatePerson(
      a.companyId,
      person.id,
      personForm({ curp: person.curp!, status: "baja" }),
      a.admin.id,
    );
    const [period] = await periodsOf(person.id);

    expect(
      (await eventByKey(person.id, `employment:period:${period.id}:baja`))
        ?.payload,
    ).toMatchObject({ kind: "baja", sin_fecha: true });

    failure.on = true;
    await expect(
      withTransaction(
        (tx) =>
          correctTermination(tx, a.companyId, person.id, baja("2025-09-15")),
        a.companyId,
      ),
    ).rejects.toThrow("timeline write failed");
    expect((await periodsOf(person.id))[0].fechaBaja).toBeNull();

    failure.on = false;
    await withTransaction(
      (tx) =>
        correctTermination(tx, a.companyId, person.id, baja("2025-09-15")),
      a.companyId,
    );
    const corrected = (await eventsOf(person.id)).filter(
      (event) => event.payload.corrected === true,
    );

    expect(corrected).toHaveLength(1);
    expect(corrected[0]).toMatchObject({
      occurredAt: new Date("2025-09-15T18:00:00Z"),
      payload: { kind: "baja", date: "2025-09-15" },
    });
    expect(corrected[0].dedupeKey).toMatch(/^employment:audit:/);
  });

  it("a renewal with a new puesto writes a «cambio»", async () => {
    const [moved] = await ownerDb
      .insert(positions)
      .values({ companyId: a.companyId, name: "Puesto renovado" })
      .returning();
    const [current] = await ownerDb
      .select()
      .from(contracts)
      .where(eq(contracts.personId, a.person.id));

    failure.on = true;
    await expect(
      decideContractRenewal(
        a.companyId,
        renewalDecisionSchema.parse({
          decision: "renovar_indeterminado",
          contractId: current.id,
          templateId: a.template.id,
          startDate: "2027-01-01",
          newPositionId: moved.id,
        }),
        a.admin.id,
      ),
    ).rejects.toThrow("timeline write failed");
    expect(
      (await ownerDb.select().from(people).where(eq(people.id, a.person.id)))[0]
        .positionId,
    ).toBe(a.position.id);

    failure.on = false;
    await decideContractRenewal(
      a.companyId,
      renewalDecisionSchema.parse({
        decision: "renovar_indeterminado",
        contractId: current.id,
        templateId: a.template.id,
        startDate: "2027-01-01",
        newPositionId: moved.id,
      }),
      a.admin.id,
    );
    const cambio = (await eventsOf(a.person.id)).find(
      (event) => event.payload.kind === "cambio",
    );

    expect(cambio).toMatchObject({
      source: "app",
      payload: { position_id: moved.id, from_position_id: a.position.id },
    });
  });

  it("an import that moves a person writes its «cambio» with source import", async () => {
    const person = await newPerson({ nombres: "Importa" });
    const job = await createImportJob(
      a.companyId,
      {
        fileName: "cambios.xlsx",
        fileHash: "f".repeat(64),
        fileSizeBytes: 1,
        totalRows: 1,
      },
      a.admin.id,
    );

    await appendImportRows(a.companyId, job.id, {
      sheet: "personas",
      rows: [
        {
          rowNumber: 2,
          cells: {
            idWorkia: person.id,
            nombres: person.nombres,
            apellidoPaterno: person.apellidoPaterno,
            sucursal: a.site.name,
          },
        },
      ],
    });
    await finalizeImportUpload(a.companyId, job.id, 1);

    while (!(await validateJobStep(a.companyId, job.id)).done);
    const [row] = await ownerDb
      .select()
      .from(importRows)
      .where(eq(importRows.jobId, job.id));
    expect(row.action).toBe("update");

    while (!(await applyJobStep(a.companyId, job.id)).done);

    const cambio = (await eventsOf(person.id)).find(
      (event) => event.payload.kind === "cambio",
    );
    expect(cambio).toMatchObject({
      source: "import",
      payload: { site_id: a.site.id, from_site_id: null },
    });
  });
});

describe("vacation and document events", () => {
  it("a vacation range writes its enjoyment and its void, or neither change", async () => {
    const person = await newPerson();
    const input = {
      personId: person.id,
      startDate: "2026-04-06",
      endDate: "2026-04-10",
      days: "5",
    };

    failure.on = true;
    await expect(
      registerVacationRecord(a.companyId, input, a.admin.id),
    ).rejects.toThrow("timeline write failed");
    expect(
      await ownerDb
        .select()
        .from(vacationRecords)
        .where(eq(vacationRecords.personId, person.id)),
    ).toEqual([]);

    failure.on = false;
    const created = await registerVacationRecord(
      a.companyId,
      input,
      a.admin.id,
    );
    if (!created?.ok) throw new Error("no vacation");

    expect(
      await eventByKey(person.id, `vacation:record:${created.id}:enjoyment`),
    ).toMatchObject({
      occurredAt: new Date("2026-04-06T18:00:00Z"),
      payload: {
        kind: "enjoyment",
        vacation_record_id: created.id,
        days: 5,
        from: "2026-04-06",
        to: "2026-04-10",
      },
    });

    failure.on = true;
    await expect(
      voidVacationRecord(a.companyId, created.id, a.admin.id),
    ).rejects.toThrow("timeline write failed");
    expect(
      (
        await ownerDb
          .select()
          .from(vacationRecords)
          .where(eq(vacationRecords.id, created.id))
      )[0].voidedAt,
    ).toBeNull();

    failure.on = false;
    await voidVacationRecord(a.companyId, created.id, a.admin.id);
    expect(
      (await eventByKey(person.id, `vacation:record:${created.id}:void`))
        ?.payload,
    ).toMatchObject({ kind: "void", days: 5 });
  });

  it("a delivery writes an accepted document, or is not recorded", async () => {
    const person = await newPerson();
    const [requirement] =
      (await setRequirements(
        a.companyId,
        {
          positionId: null,
          requirements: [
            {
              name: "INE",
              required: true,
              validityMonths: 12,
              sort: 0,
              active: true,
            },
          ],
        },
        a.admin.id,
      )) ?? [];
    const input = {
      personId: person.id,
      requirementId: requirement.id,
      deliveredOn: "2026-03-02",
    };

    failure.on = true;
    await expect(
      recordDelivery(a.companyId, input, a.admin.id),
    ).rejects.toThrow("timeline write failed");
    expect(
      await ownerDb
        .select()
        .from(personDocuments)
        .where(eq(personDocuments.personId, person.id)),
    ).toEqual([]);

    failure.on = false;
    const created = await recordDelivery(a.companyId, input, a.admin.id);

    expect(
      await eventByKey(
        person.id,
        `document:person_document:${created!.id}:accepted`,
      ),
    ).toMatchObject({
      occurredAt: new Date("2026-03-02T18:00:00Z"),
      payload: {
        status: "accepted",
        requirement_id: requirement.id,
        delivered_on: "2026-03-02",
        expires_on: "2027-03-02",
      },
    });
  });
});

describe("attendance and incidencias", () => {
  it("one row per person per day, its punches merged without UPDATE", async () => {
    const person = await newPerson();
    const day = (punches: { at: string; kind: "in" | "out" }[]) => ({
      personId: person.id,
      day: "2026-11-03",
      siteId: a.site.id,
      source: "checador:entrada-1",
      punches,
    });

    expect(
      await writeAttendanceDays(a.companyId, [
        day([{ at: "2026-11-03T14:02:00Z", kind: "in" }]),
      ]),
    ).toEqual({ inserted: 1, merged: 0, unchanged: 0 });
    // The same file again: nothing written.
    expect(
      await writeAttendanceDays(a.companyId, [
        day([{ at: "2026-11-03T14:02:00Z", kind: "in" }]),
      ]),
    ).toEqual({ inserted: 0, merged: 0, unchanged: 1 });
    // A re-upload that infers another kind for the same instant adds nothing.
    expect(
      await writeAttendanceDays(a.companyId, [
        day([{ at: "2026-11-03T14:02:00Z", kind: "out" }]),
      ]),
    ).toEqual({ inserted: 0, merged: 0, unchanged: 1 });
    // The exit arrives later, twice in one call.
    expect(
      await writeAttendanceDays(a.companyId, [
        day([{ at: "2026-11-03T23:01:00Z", kind: "out" }]),
        day([{ at: "2026-11-03T23:01:00Z", kind: "out" }]),
      ]),
    ).toEqual({ inserted: 0, merged: 1, unchanged: 0 });

    const rows = (await eventsOf(person.id)).filter(
      (event) => event.type === "attendance",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      dedupeKey: "attendance:2026-11-03",
      occurredAt: new Date("2026-11-03T14:02:00Z"),
      payload: {
        site_id: a.site.id,
        punches: [
          ["2026-11-03T14:02:00Z", "in"],
          ["2026-11-03T23:01:00Z", "out"],
        ],
      },
    });
    expect(readAttendance(rows[0].payload)).toEqual({
      siteId: a.site.id,
      punches: [
        { at: "2026-11-03T14:02:00Z", kind: "in" },
        { at: "2026-11-03T23:01:00Z", kind: "out" },
      ],
      firstIn: "2026-11-03T14:02:00Z",
      lastOut: "2026-11-03T23:01:00Z",
    });
  });

  it("a failed batch leaves the stored day as it was", async () => {
    const person = await newPerson();
    const input = {
      personId: person.id,
      day: "2026-11-04",
      source: "checador",
      punches: [{ at: "2026-11-04T14:00:00Z", kind: "in" as const }],
    };
    await writeAttendanceDays(a.companyId, [input]);

    failure.on = true;
    await expect(
      writeAttendanceDays(a.companyId, [
        {
          ...input,
          punches: [{ at: "2026-11-04T23:00:00Z", kind: "out" as const }],
        },
      ]),
    ).rejects.toThrow("timeline write failed");
    failure.on = false;

    const [row] = (await eventsOf(person.id)).filter(
      (event) => event.type === "attendance",
    );
    expect(row.payload.punches).toHaveLength(1);
  });

  it("a day another writer stored first is a conflict, not lost punches", async () => {
    const person = await newPerson();

    await expect(
      withTransaction(async (tx) => {
        // Another job's row lands between this job's read and its insert.
        await appendPersonEvents(
          a.companyId,
          [
            {
              personId: person.id,
              type: "attendance",
              occurredAt: new Date("2026-11-05T14:00:00Z"),
              source: "otro",
              dedupeKey: "attendance:2026-11-05",
              payload: { punches: [] },
            },
          ],
          tx,
        );
        const mocked = vi.spyOn(tx, "select").mockImplementationOnce(
          () =>
            ({
              from: () => ({ where: async () => [] }),
            }) as never,
        );
        try {
          await writeAttendanceDays(
            a.companyId,
            [
              {
                personId: person.id,
                day: "2026-11-05",
                source: "checador",
                punches: [{ at: "2026-11-05T14:00:00Z", kind: "in" }],
              },
            ],
            tx,
          );
        } finally {
          mocked.mockRestore();
        }
      }, a.companyId),
    ).rejects.toBeInstanceOf(TimelineConflictError);
  });

  it("a recomputed open period keeps what did not change and swaps the rest", async () => {
    const person = await newPerson();
    const retardo = {
      personId: person.id,
      day: "2026-11-03",
      kind: "retardo" as const,
      minutes: 12,
      source: "engine",
    };
    const falta = {
      personId: person.id,
      day: "2026-11-04",
      kind: "falta" as const,
      source: "engine",
    };

    expect(
      await replacePeriodIncidencias(a.companyId, {
        period: "2026-11-1",
        personIds: [person.id],
        incidencias: [retardo, falta],
      }),
    ).toEqual({ inserted: 2, deleted: 0, unchanged: 0 });
    // The falta is justified by a permiso; the retardo stays as it was.
    expect(
      await replacePeriodIncidencias(a.companyId, {
        period: "2026-11-1",
        personIds: [person.id],
        incidencias: [
          retardo,
          { ...falta, justified: true, justificationRef: "permiso:1" },
        ],
      }),
    ).toEqual({ inserted: 1, deleted: 1, unchanged: 1 });
    // Another period of the same person is left alone.
    await replacePeriodIncidencias(a.companyId, {
      period: "2026-10-2",
      personIds: [person.id],
      incidencias: [{ ...falta, day: "2026-10-20" }],
    });
    expect(
      await replacePeriodIncidencias(a.companyId, {
        period: "2026-11-1",
        personIds: [person.id],
        incidencias: [],
      }),
    ).toEqual({ inserted: 0, deleted: 2, unchanged: 0 });

    const left = (await eventsOf(person.id)).filter(
      (event) => event.type === "incidencia",
    );
    expect(left.map((event) => event.dedupeKey)).toEqual([
      "incidencia:2026-10-2:2026-10-20:falta",
    ]);
  });
});

describe("one person's timeline", () => {
  it("returns every type in time order", async () => {
    const person = await newPerson({ fechaIngreso: "2021-05-03" });
    await registerVacationRecord(
      a.companyId,
      {
        personId: person.id,
        startDate: "2024-07-01",
        endDate: "2024-07-05",
        days: "5",
      },
      a.admin.id,
    );
    const [requirement] =
      (await setRequirements(
        a.companyId,
        {
          positionId: null,
          requirements: [
            {
              name: "INE",
              required: true,
              validityMonths: 12,
              sort: 0,
              active: true,
            },
          ],
        },
        a.admin.id,
      )) ?? [];
    await recordDelivery(
      a.companyId,
      {
        personId: person.id,
        requirementId: requirement.id,
        deliveredOn: "2021-05-04",
      },
      a.admin.id,
    );
    await appendPersonEvents(a.companyId, [
      receiptEvent({
        personId: person.id,
        cfdiUuid: "6F9619FF-8B86-D011-B42D-00C04FC964FF",
        period: "2025-01-1",
        deliveredAt: new Date("2025-01-16T15:00:00Z"),
        source: "payroll",
      }),
    ]);
    await writeAttendanceDays(a.companyId, [
      {
        personId: person.id,
        day: "2025-02-03",
        source: "checador",
        punches: [{ at: "2025-02-03T15:00:00Z", kind: "in" }],
      },
    ]);
    await replacePeriodIncidencias(a.companyId, {
      period: "2025-02-1",
      personIds: [person.id],
      incidencias: [
        {
          personId: person.id,
          day: "2025-02-04",
          kind: "falta",
          source: "engine",
        },
      ],
    });
    await terminatePerson(
      a.companyId,
      person.id,
      baja("2025-03-31"),
      a.admin.id,
    );

    const page = await listPersonEvents(a.companyId, person.id, {
      limit: 200,
    });
    const times = page.events.map((event) => event.occurredAt.getTime());

    expect(new Set(page.events.map((event) => event.type))).toEqual(
      new Set(PERSON_EVENT_TYPES),
    );
    expect(times).toEqual([...times].sort((x, y) => y - x));
    expect(page.events.at(0)?.payload.kind).toBe("baja");
    expect(page.events.at(-1)?.payload.kind).toBe("alta");
  });
});

describe("backfill", () => {
  it("writes the facts the app wrote before W2-13, once, and the counts match", async () => {
    const t = await seedTenant("TB");
    // Facts written before the timeline existed: rows with no events.
    const [period] = await ownerDb
      .insert(employmentPeriods)
      .values({
        companyId: t.companyId,
        personId: t.person.id,
        fechaIngreso: "2019-01-07",
        fechaAntiguedad: "2019-01-07",
        fechaBaja: "2024-12-31",
        tipoBaja: "voluntaria",
      })
      .returning();
    const [record] = await ownerDb
      .insert(vacationRecords)
      .values({
        companyId: t.companyId,
        personId: t.person.id,
        employmentPeriodId: period.id,
        serviceYear: 1,
        startDate: "2020-03-02",
        endDate: "2020-03-07",
        days: "6",
        voidedAt: new Date("2020-03-01T17:00:00Z"),
      })
      .returning();
    const [requirement] =
      (await setRequirements(
        t.companyId,
        {
          positionId: null,
          requirements: [
            {
              name: "Acta",
              required: true,
              validityMonths: null,
              sort: 0,
              active: true,
            },
          ],
        },
        t.admin.id,
      )) ?? [];
    await ownerDb.insert(personDocuments).values({
      companyId: t.companyId,
      personId: t.person.id,
      requirementId: requirement.id,
      deliveredOn: "2019-01-07",
    });
    await ownerDb.insert(auditEvents).values([
      {
        companyId: t.companyId,
        resourceType: "person",
        resourceId: t.person.id,
        action: "update",
        occurredAt: new Date("2022-06-01T16:00:00Z"),
        payload: { changes: { siteId: { from: null, to: t.site.id } } },
      },
      // Not a cambio: a phone change, and an event with no person.
      {
        companyId: t.companyId,
        resourceType: "person",
        resourceId: t.person.id,
        action: "update",
        payload: { changes: { telefono: { from: null, to: "55" } } },
      },
      {
        companyId: t.companyId,
        resourceType: "site",
        resourceId: t.site.id,
        action: "update",
        payload: { changes: { siteId: { from: null, to: t.site.id } } },
      },
    ]);
    await ownerDb
      .delete(personEvents)
      .where(eq(personEvents.companyId, t.companyId));

    const dry = await backfillPersonTimeline({ companyId: t.companyId });
    expect(dry.applied).toBe(false);
    expect(dry.counts.alta).toEqual({ source: 1, inserted: 1, stored: 0 });
    expect(
      await ownerDb
        .select()
        .from(personEvents)
        .where(eq(personEvents.companyId, t.companyId)),
    ).toEqual([]);

    const applied = await backfillPersonTimeline({
      companyId: t.companyId,
      apply: true,
    });
    expect(applied.counts).toEqual({
      alta: { source: 1, inserted: 1, stored: 1 },
      baja: { source: 1, inserted: 1, stored: 1 },
      cambio: { source: 1, inserted: 1, stored: 1 },
      vacation_enjoyment: { source: 1, inserted: 1, stored: 1 },
      vacation_void: { source: 1, inserted: 1, stored: 1 },
      document: { source: 1, inserted: 1, stored: 1 },
    });
    expect(applied.matches).toBe(true);

    const events = await eventsOf(t.person.id);
    // A «cambio» keeps the source of its audit event; the rest say backfill.
    for (const event of events) {
      expect(event.source).toBe(
        event.payload.kind === "cambio" ? "app" : "backfill",
      );
    }
    expect(
      events.find((event) => event.dedupeKey?.endsWith(":enjoyment")),
    ).toMatchObject({
      dedupeKey: `vacation:record:${record.id}:enjoyment`,
      occurredAt: new Date("2020-03-02T18:00:00Z"),
    });

    const again = await backfillPersonTimeline({
      companyId: t.companyId,
      apply: true,
    });
    expect(
      Object.values(again.counts).every((count) => count.inserted === 0),
    ).toBe(true);
    expect(again.matches).toBe(true);
  });

  it("skips what the live writes already stored", async () => {
    const person = await newPerson();
    await terminatePerson(a.companyId, person.id, baja(), a.admin.id);
    const before = await ownerDb
      .select()
      .from(personEvents)
      .where(like(personEvents.dedupeKey, "employment:period:%"));

    const report = await backfillPersonTimeline({
      companyId: a.companyId,
      apply: true,
    });

    expect(report.matches).toBe(true);
    expect(
      await ownerDb
        .select()
        .from(personEvents)
        .where(like(personEvents.dedupeKey, "employment:period:%")),
    ).toHaveLength(before.length);
  });
});
