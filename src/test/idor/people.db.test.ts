/**
 * Cross-company isolation for people and schedules (WRK-I4-7). Company B's
 * session and company id ask for company A's records: reads find nothing and
 * writes change nothing. Test titles are the surface ids of docs/idor-matrix.md.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  countActivePeople,
  countPeopleByStatus,
  createPerson,
  findIdentityConflicts,
  getPersonById,
  getPersonSchedule,
  getPersonWithRelations,
  listActivePeopleForSelect,
  listPeople,
  listPeoplePage,
  searchActivePeopleForSelect,
  softDeletePerson,
  updatePerson,
  upsertPersonSchedule,
} from "@/lib/people";
import {
  createPersonAction,
  deletePersonAction,
  searchManagerOptionsAction,
  updatePersonAction,
} from "@/lib/people/actions";
import type { PersonFormValues } from "@/lib/people/schema";

import {
  idsIn,
  seedTenant,
  snapshotTenant,
  tenantIds,
  type Tenant,
} from "./fixtures";
import { actAs, NavigationThrow } from "./session-state";

let a: Tenant;
let b: Tenant;

const form = (overrides: Partial<PersonFormValues> = {}): PersonFormValues => ({
  nombres: "Intrusa",
  apellidoPaterno: "B",
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

const formData = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

const noLeak = (value: unknown) => {
  const leaked = idsIn(value).filter((id) => tenantIds(a).has(id));
  expect(leaked, "ids of company A in company B's result").toEqual([]);
};

beforeAll(async () => {
  a = await seedTenant("A");
  b = await seedTenant("B");
});

describe("people reads stay inside the company", () => {
  it("lib:people/listPeople", async () => {
    const rows = await listPeople(b.companyId, { includeDeleted: true });
    noLeak(rows);
    expect(rows.map((row) => row.id)).toContain(b.person.id);
  });

  it("lib:people/listPeoplePage", async () => {
    for (const deleted of [false, true]) {
      noLeak(
        await listPeoplePage(b.companyId, { page: 1, pageSize: 100, deleted }),
      );
    }
    noLeak(
      await listPeoplePage(b.companyId, {
        page: 1,
        pageSize: 100,
        query: "Persona A",
      }),
    );
  });

  it("lib:people/listActivePeopleForSelect", async () => {
    noLeak(await listActivePeopleForSelect(b.companyId));
  });

  it("lib:people/searchActivePeopleForSelect", async () => {
    noLeak(await searchActivePeopleForSelect(b.companyId, "Persona"));
    expect(
      await searchActivePeopleForSelect(b.companyId, a.person.curp!),
    ).toEqual([]);
  });

  it("lib:people/getPersonById", async () => {
    expect(await getPersonById(b.companyId, a.person.id, true)).toBeNull();
  });

  it("lib:people/getPersonWithRelations", async () => {
    expect(
      await getPersonWithRelations(b.companyId, a.person.id, true),
    ).toBeNull();
  });

  it("lib:people/getPersonSchedule", async () => {
    expect(await getPersonSchedule(b.companyId, a.person.id, true)).toBeNull();
  });

  it("lib:people/findIdentityConflicts", async () => {
    // A's CURP is free in B: identity is unique per company.
    expect(
      await findIdentityConflicts(b.companyId, {
        curp: a.person.curp ?? "",
        rfc: a.person.rfc ?? "",
        nss: a.person.nss ?? "",
      }),
    ).toEqual([]);
  });

  it("lib:people/countPeopleByStatus", async () => {
    const before = await countPeopleByStatus(b.companyId);
    await createPerson(a.companyId, form({ nombres: "Solo A" }), a.admin.id);
    expect(await countPeopleByStatus(b.companyId)).toEqual(before);
  });

  it("lib:people/countActivePeople", async () => {
    const before = await countActivePeople(b.companyId);
    await createPerson(a.companyId, form({ nombres: "Otra de A" }), a.admin.id);
    expect(await countActivePeople(b.companyId)).toBe(before);
  });
});

describe("people writes cannot reach another company", () => {
  it("lib:people/createPerson", async () => {
    // References to A's catalog or people are refused in B.
    for (const field of [
      "areaId",
      "positionId",
      "siteId",
      "managerId",
    ] as const) {
      const id = {
        areaId: a.area.id,
        positionId: a.position.id,
        siteId: a.site.id,
        managerId: a.person.id,
      }[field];
      await expect(
        createPerson(b.companyId, form({ [field]: id }), b.admin.id),
      ).rejects.toMatchObject({
        name: "CompanyReferenceError",
        field,
      });
    }

    // The same CURP as a person of A is accepted in B, as a new person of B.
    const created = await createPerson(
      b.companyId,
      form({ curp: a.person.curp ?? "", rfc: a.person.rfc ?? "" }),
      b.admin.id,
    );
    expect(created.companyId).toBe(b.companyId);
  });

  it("lib:people/updatePerson", async () => {
    const before = await snapshotTenant(a);
    expect(
      await updatePerson(b.companyId, a.person.id, form(), b.admin.id),
    ).toBeNull();
    await expect(
      updatePerson(
        b.companyId,
        b.teammate.id,
        form({ managerId: a.person.id }),
        b.admin.id,
      ),
    ).rejects.toMatchObject({
      name: "CompanyReferenceError",
      field: "managerId",
    });
    expect(await snapshotTenant(a)).toEqual(before);
  });

  it("lib:people/softDeletePerson", async () => {
    expect(
      await softDeletePerson(b.companyId, a.person.id, b.admin.id),
    ).toBeNull();
    expect(
      (await getPersonById(a.companyId, a.person.id))?.deletedAt,
    ).toBeNull();
  });

  it("lib:people/upsertPersonSchedule", async () => {
    const before = await snapshotTenant(a);
    // B's company id on A's person: the schedule lookup finds nothing of A to change,
    // and inserting a schedule for A's person under B is refused by the composite key.
    await expect(
      upsertPersonSchedule(
        b.companyId,
        a.person.id,
        form({ horarioEntrada: "07:00" }),
        b.admin.id,
      ),
    ).rejects.toThrow();
    expect(await snapshotTenant(a)).toEqual(before);
  });
});

describe("people actions with company B's session", () => {
  it("action:people/createPersonAction", async () => {
    actAs(b.admin);
    const result = await createPersonAction(
      {},
      formData({
        ...form({ managerId: a.person.id }),
        companyId: b.companyId,
      } as unknown as Record<string, string>),
    );
    expect(result.fieldErrors?.managerId).toBeTruthy();
  });

  it("action:people/updatePersonAction", async () => {
    actAs(b.admin);
    const before = await snapshotTenant(a);
    const result = await updatePersonAction(
      a.person.id,
      {},
      formData({ ...form(), companyId: b.companyId } as unknown as Record<
        string,
        string
      >),
    );
    expect(result.error).toBe("No encontramos a esta persona.");
    expect(await snapshotTenant(a)).toEqual(before);
  });

  it("action:people/deletePersonAction", async () => {
    actAs(b.admin);
    await expect(deletePersonAction(a.person.id)).rejects.toMatchObject({
      kind: "redirect",
      url: "/app/personas?error=not-found",
    });
    expect(
      (await getPersonById(a.companyId, a.person.id))?.deletedAt,
    ).toBeNull();
  });

  it("action:people/searchManagerOptionsAction", async () => {
    actAs(b.admin);
    noLeak(await searchManagerOptionsAction("Persona"));
  });

  it("refuses a form opened in another company (two tabs)", async () => {
    actAs(b.admin);
    const result = await createPersonAction(
      {},
      formData({ ...form(), companyId: a.companyId } as unknown as Record<
        string,
        string
      >),
    );
    expect(result.error).toBe("La empresa activa cambió. Recarga la página.");
  });
});

describe("people permissions", () => {
  it("rbac:action:people/createPersonAction", async () => {
    actAs(b.viewer);
    expect(
      (
        await createPersonAction(
          {},
          formData(form() as unknown as Record<string, string>),
        )
      ).error,
    ).toMatch(/permiso/);
  });

  it("rbac:action:people/updatePersonAction", async () => {
    actAs(b.viewer);
    expect(
      (
        await updatePersonAction(
          b.person.id,
          {},
          formData(form() as unknown as Record<string, string>),
        )
      ).error,
    ).toMatch(/permiso/);
  });

  it("rbac:action:people/deletePersonAction", async () => {
    actAs(b.viewer);
    await expect(deletePersonAction(b.person.id)).rejects.toMatchObject({
      url: `/app/personas/${b.person.id}?error=delete-forbidden`,
    });
  });

  it("a user without membership gets no company and nothing", async () => {
    actAs({
      id: "00000000-0000-0000-0000-00000000dead",
      email: "nadie@idor.test",
    });
    expect(await searchManagerOptionsAction("Persona")).toEqual([]);
    await expect(deletePersonAction(b.person.id)).rejects.toBeInstanceOf(
      NavigationThrow,
    );
  });
});

describe("expediente México (WRK-I5-1)", () => {
  it("stores the México data and beneficiaries, and keeps them when an update does not send them", async () => {
    const { listPersonBeneficiaries } = await import("@/lib/people");
    const created = await createPerson(
      a.companyId,
      form({
        nombres: "México",
        apellidoPaterno: "Datos",
        domicilioCalle: "Av. Central",
        domicilioCodigoPostal: "29000",
        domicilioEstado: "Chiapas",
        estadoCivil: "casado",
        ineClaveElector: "LPRZAN80010107M100",
        beneficiarios: [
          { nombre: "Hija", parentesco: "Hija", porcentaje: 70 },
          { nombre: "Hijo", parentesco: "Hijo", porcentaje: 30 },
        ],
      }),
      a.admin.id,
    );

    expect(created).toMatchObject({
      domicilioCalle: "Av. Central",
      estadoCivil: "casado",
    });
    expect(
      await listPersonBeneficiaries(a.companyId, created.id),
    ).toMatchObject([
      { nombre: "Hija", porcentaje: 70 },
      { nombre: "Hijo", porcentaje: 30 },
    ]);

    // An update without the México fields (import, MCP) keeps them.
    const updated = await updatePerson(
      a.companyId,
      created.id,
      form({ nombres: "México", apellidoPaterno: "Editado" }),
      a.admin.id,
    );
    expect(updated).toMatchObject({
      domicilioCalle: "Av. Central",
      ineClaveElector: "LPRZAN80010107M100",
    });
    expect(await listPersonBeneficiaries(a.companyId, created.id)).toHaveLength(
      2,
    );

    // An explicit empty list removes them.
    await updatePerson(
      a.companyId,
      created.id,
      form({
        nombres: "México",
        apellidoPaterno: "Editado",
        beneficiarios: [],
      }),
      a.admin.id,
    );
    expect(await listPersonBeneficiaries(a.companyId, created.id)).toHaveLength(
      0,
    );
  });

  it("lib:people/listPersonBeneficiaries", async () => {
    const { listPersonBeneficiaries } = await import("@/lib/people");
    await updatePerson(
      a.companyId,
      a.person.id,
      form({
        nombres: a.person.nombres,
        apellidoPaterno: a.person.apellidoPaterno,
        beneficiarios: [
          { nombre: "Beneficiaria A", parentesco: "Madre", porcentaje: 100 },
        ],
      }),
      a.admin.id,
    );

    expect(await listPersonBeneficiaries(b.companyId, a.person.id)).toEqual([]);
    expect(
      await listPersonBeneficiaries(a.companyId, a.person.id),
    ).toHaveLength(1);
  });
});
