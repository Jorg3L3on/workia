/**
 * Schedule by blocks (WRK-I5-3): stored with the simple fields mirrored,
 * audited as readable text, frozen in contracts and used by {{horario}}; a
 * simple-schedule write replaces the blocks.
 */
import { and, desc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import {
  createContract,
  softDeleteContract,
  updateContractTemplate,
} from "@/lib/contracts";
import { auditEvents, personSchedules } from "@/lib/db/schema";
import { createPerson, getPersonSchedule, updatePerson } from "@/lib/people";
import type { PersonFormValues } from "@/lib/people/schema";

import { ownerDb, seedTenant, type Tenant } from "./fixtures";

let t: Tenant;

const form = (overrides: Partial<PersonFormValues> = {}): PersonFormValues => ({
  nombres: "Bloques",
  apellidoPaterno: "Prueba",
  apellidoMaterno: "",
  email: "",
  telefono: "",
  fechaNacimiento: "",
  fechaIngreso: "",
  areaId: "",
  positionId: "",
  managerId: "",
  siteId: "",
  rfc: "",
  curp: "",
  nss: "",
  horarioEntrada: "",
  horarioSalidaComer: "",
  horarioRegresoComer: "",
  horarioSalida: "",
  status: "activa",
  ...overrides,
});

const blocks = {
  bloques: [
    {
      dias: ["lun", "mar", "mie", "jue", "vie"] as const,
      entrada: "08:00",
      salida: "17:00",
      comidaInicio: "13:00",
      comidaFin: "14:00",
    },
    {
      dias: ["sab"] as const,
      entrada: "08:00",
      salida: "13:00",
      comidaInicio: null,
      comidaFin: null,
    },
  ].map((block) => ({ ...block, dias: [...block.dias] })),
  diaDescanso: "dom" as const,
};
const TEXT =
  "L–V 08:00–17:00 (comida 13:00–14:00) · Sáb 08:00–13:00 · Descanso dom";

let personId: string;

beforeAll(async () => {
  t = await seedTenant("BLOQUES");
  await updateContractTemplate(
    t.companyId,
    t.template.id,
    { name: t.template.name, body: "Horario: {{horario}}", active: true },
    t.admin.id,
  );
});

describe("schedule by blocks", () => {
  it("stores the blocks and mirrors the first one in the simple fields", async () => {
    const created = await createPerson(
      t.companyId,
      form({ horarioBloques: blocks }),
      t.admin.id,
    );
    personId = created.id;
    const schedule = await getPersonSchedule(t.companyId, personId);

    expect(schedule).toMatchObject({
      entrada: "08:00",
      salidaComer: "13:00",
      regresoComer: "14:00",
      salida: "17:00",
      restDay: "dom",
    });
    expect(schedule?.blocks).toHaveLength(2);
  });

  it("audits a change of blocks as readable text", async () => {
    await updatePerson(
      t.companyId,
      personId,
      form({
        horarioBloques: { ...blocks, diaDescanso: null },
      }),
      t.admin.id,
    );
    const events = await ownerDb
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.resourceId, personId),
          eq(auditEvents.action, "update"),
        ),
      )
      .orderBy(desc(auditEvents.occurredAt));
    const event = events.find(
      (row) =>
        (row.payload as { summary?: string }).summary === "Edición de horario",
    )!;

    expect(event.payload).toMatchObject({
      summary: "Edición de horario",
      changes: {
        bloques: {
          from: TEXT,
          to: "L–V 08:00–17:00 (comida 13:00–14:00) · Sáb 08:00–13:00",
        },
      },
    });
  });

  it("the same blocks again change nothing", async () => {
    const before = await getPersonSchedule(t.companyId, personId);
    await updatePerson(
      t.companyId,
      personId,
      form({ horarioBloques: { ...blocks, diaDescanso: null } }),
      t.admin.id,
    );
    const after = await getPersonSchedule(t.companyId, personId);
    expect(after?.updatedAt).toEqual(before?.updatedAt);
  });

  it("a contract freezes the blocks and {{horario}} uses the text", async () => {
    await updatePerson(
      t.companyId,
      personId,
      form({ horarioBloques: blocks }),
      t.admin.id,
    );
    const contract = await createContract(
      t.companyId,
      {
        personId,
        templateId: t.template.id,
        type: "indeterminado",
        startDate: "2026-09-01",
        endDate: "",
        noticeWindow: "no_avisar",
      },
      t.admin.id,
    );

    expect(contract.generatedText).toBe(`Horario: ${TEXT}`);
    expect(contract.scheduleBlocks).toHaveLength(2);
    expect(contract.scheduleRestDay).toBe("dom");

    // Editing the person afterwards does not touch the emitted contract.
    await updatePerson(
      t.companyId,
      personId,
      form({ horarioBloques: { bloques: [], diaDescanso: null } }),
      t.admin.id,
    );
    const [row] = await ownerDb
      .select()
      .from(personSchedules)
      .where(eq(personSchedules.personId, personId));
    expect(row.deletedAt).not.toBeNull();
    expect(row.blocks).toBeNull();
    await softDeleteContract(t.companyId, contract.id, t.admin.id);
  });

  it("a simple-schedule write (import, update_person_schedule) replaces the blocks", async () => {
    await updatePerson(
      t.companyId,
      personId,
      form({ horarioBloques: blocks }),
      t.admin.id,
    );
    await updatePerson(
      t.companyId,
      personId,
      form({ horarioEntrada: "07:00", horarioSalida: "15:00" }),
      t.admin.id,
    );
    const schedule = await getPersonSchedule(t.companyId, personId);
    expect(schedule).toMatchObject({
      entrada: "07:00",
      salida: "15:00",
      salidaComer: null,
      blocks: null,
      restDay: null,
    });
  });
});
