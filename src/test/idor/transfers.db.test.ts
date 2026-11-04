/**
 * Transfers between subsidiaries (Workia 2.0 W2-24) on a real database. A
 * transfer closes the period in one company, opens one in the other on a new
 * or reopened row, links both rows by id and keeps group seniority; the group
 * timeline reads both companies, each under its own RLS. Refused when the
 * CURPs differ, and company B can neither transfer nor read company A's
 * people. Titles are the surface ids of docs/idor-matrix.md.
 */
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => [] as { to: string }[]);

vi.mock("@/lib/email", () => ({
  emailConfigured: () => true,
  sendEmail: async (message: { to: string }) => {
    sent.push(message);
  },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: () => {},
    delete: () => {},
  }),
  headers: async () => new Headers({ host: "workia.test" }),
}));

import {
  auditEvents,
  companyMemberships,
  contracts,
  employeeAccounts,
  employmentPeriods,
  people,
  personBeneficiaries,
  personEvents,
  personLinks,
  users,
} from "@/lib/db/schema";
import { sampleCurp } from "@/lib/people/identity";
import {
  listPersonLinks,
  TRANSFER_COPY,
  TransferError,
  transferPerson,
} from "@/lib/transfers";
import { setGroupAdminAction } from "@/lib/transfers/admin-actions";
import { transferPersonAction } from "@/lib/transfers/actions";
import { describeGroupEvent } from "@/lib/transfers/describe";
import { listGroupTimeline, loadGroupReader } from "@/lib/transfers/group";

import { ownerDb, seedRbac, seedTenant, type Tenant } from "./fixtures";
import { actAs, NavigationThrow } from "./session-state";

let a: Tenant;
let b: Tenant;
/** HR with admin in both companies: may transfer between them. */
let hr: { id: string; email: string };
/** HR with people:read in A only. */
let reader: { id: string; email: string };

const formData = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

const newUser = async (email: string) =>
  (await ownerDb.insert(users).values({ email, name: email }).returning())[0];

let curpIndex = 7_100;

/** An active person of A hired 2020-03-01, with a vigente contract, a beneficiary and an employee account. */
const hireInA = async (email: string) => {
  const [person] = await ownerDb
    .insert(people)
    .values({
      companyId: a.companyId,
      nombres: "Traslado",
      apellidoPaterno: `Prueba${curpIndex}`,
      curp: sampleCurp(curpIndex++),
      email,
      fechaIngreso: "2020-03-01",
      positionId: a.position.id,
      siteId: a.site.id,
    })
    .returning();
  await ownerDb.insert(employmentPeriods).values({
    companyId: a.companyId,
    personId: person.id,
    fechaIngreso: "2020-03-01",
    fechaAntiguedad: "2020-03-01",
  });
  await ownerDb.insert(contracts).values({
    companyId: a.companyId,
    personId: person.id,
    type: "indeterminado",
    startDate: "2020-03-01",
    templateName: "Plantilla",
    generatedText: "texto",
  });
  await ownerDb.insert(personBeneficiaries).values({
    companyId: a.companyId,
    personId: person.id,
    nombre: "Beneficiaria",
    parentesco: "Madre",
    porcentaje: "100",
  });
  await ownerDb.insert(employeeAccounts).values({
    companyId: a.companyId,
    personId: person.id,
    email,
    status: "active",
    emailVerifiedAt: new Date(),
  });

  return person;
};

const rowsOf = async (companyId: string, personId: string) => ({
  person: (
    await ownerDb.select().from(people).where(eq(people.id, personId))
  )[0],
  periods: await ownerDb
    .select()
    .from(employmentPeriods)
    .where(
      and(
        eq(employmentPeriods.companyId, companyId),
        eq(employmentPeriods.personId, personId),
      ),
    ),
  links: await ownerDb
    .select()
    .from(personLinks)
    .where(eq(personLinks.personId, personId)),
  events: await ownerDb
    .select()
    .from(personEvents)
    .where(eq(personEvents.personId, personId)),
});

beforeAll(async () => {
  a = await seedTenant("TRA");
  b = await seedTenant("TRB");
  const roles = await seedRbac();
  hr = await newUser(`traslados-${Date.now()}@idor.test`);
  reader = await newUser(`lector-${Date.now()}@idor.test`);
  await ownerDb.insert(companyMemberships).values([
    {
      userId: hr.id,
      companyId: a.companyId,
      roleId: roles.get("admin")!,
      isDefault: true,
    },
    { userId: hr.id, companyId: b.companyId, roleId: roles.get("admin")! },
    {
      userId: reader.id,
      companyId: a.companyId,
      roleId: roles.get("viewer")!,
      isDefault: true,
    },
  ]);
});

describe("lib:transfers/transferPerson", () => {
  it("refuses company B transferring company A's person, with no effect", async () => {
    const person = await hireInA(`b-no-${Date.now()}@idor.test`);
    const before = await rowsOf(a.companyId, person.id);

    expect(
      await transferPerson(
        b.companyId,
        person.id,
        { toCompanyId: a.companyId, fechaTraslado: "2026-11-16" },
        b.admin.id,
      ),
    ).toBeNull();
    expect(await rowsOf(a.companyId, person.id)).toEqual(before);
  });

  it("closes A, opens B with group seniority, links both rows and keeps the timeline continuous", async () => {
    const email = `mueve-${Date.now()}@idor.test`;
    const person = await hireInA(email);
    sent.length = 0;

    const result = await transferPerson(
      a.companyId,
      person.id,
      {
        toCompanyId: b.companyId,
        fechaTraslado: "2026-11-16",
        positionId: b.position.id,
        siteId: b.site.id,
      },
      hr.id,
      { reinvite: { origin: "https://workia.test" } },
    );

    expect(result).toMatchObject({
      toCompanyId: b.companyId,
      reusedRow: false,
      fechaAntiguedad: "2020-03-01",
      invitation: { email, sent: true },
    });
    expect(sent.map((message) => message.to)).toEqual([email]);

    const from = await rowsOf(a.companyId, person.id);
    const to = await rowsOf(b.companyId, result!.toPersonId);

    // The old company: baja the day before, tipo traslado, no motivo.
    expect(from.person.status).toBe("baja");
    expect(from.periods).toHaveLength(1);
    expect(from.periods[0]).toMatchObject({
      fechaBaja: "2026-11-15",
      tipoBaja: "traslado",
      motivoBajaId: null,
      recontratable: null,
    });
    const [contract] = await ownerDb
      .select()
      .from(contracts)
      .where(eq(contracts.personId, person.id));
    expect(contract).toMatchObject({
      status: "terminado",
      endDate: "2026-11-15",
    });
    const [oldAccount] = await ownerDb
      .select()
      .from(employeeAccounts)
      .where(eq(employeeAccounts.personId, person.id));
    expect(oldAccount.status).toBe("disabled");

    // The new company: a row copied without re-capture, seniority kept.
    expect(to.person).toMatchObject({
      companyId: b.companyId,
      status: "activa",
      curp: person.curp,
      nombres: person.nombres,
      email,
      fechaIngreso: "2026-11-16",
      positionId: b.position.id,
      siteId: b.site.id,
      areaId: null,
    });
    expect(to.periods).toHaveLength(1);
    expect(to.periods[0]).toMatchObject({
      fechaIngreso: "2026-11-16",
      reconoceAntiguedad: true,
      fechaAntiguedadReconocida: "2020-03-01",
      fechaAntiguedad: "2020-03-01",
    });
    expect(
      await ownerDb
        .select({ nombre: personBeneficiaries.nombre })
        .from(personBeneficiaries)
        .where(eq(personBeneficiaries.personId, to.person.id)),
    ).toEqual([{ nombre: "Beneficiaria" }]);
    const [invited] = await ownerDb
      .select()
      .from(employeeAccounts)
      .where(eq(employeeAccounts.personId, to.person.id));
    expect(invited).toMatchObject({ status: "invited", email });

    // One link per side, by id, sharing the transfer.
    expect(from.links).toEqual([
      expect.objectContaining({
        companyId: a.companyId,
        linkedCompanyId: b.companyId,
        linkedPersonId: to.person.id,
        direction: "out",
        transferId: result!.transferId,
        employmentPeriodId: from.periods[0].id,
        transferDate: "2026-11-16",
      }),
    ]);
    expect(to.links).toEqual([
      expect.objectContaining({
        companyId: b.companyId,
        linkedCompanyId: a.companyId,
        linkedPersonId: person.id,
        direction: "in",
        transferId: result!.transferId,
        employmentPeriodId: to.periods[0].id,
      }),
    ]);

    // An employment event in each company.
    expect(
      from.events
        .filter((event) => event.type === "employment")
        .map((event) => event.payload.kind)
        .sort(),
    ).toEqual(["baja", "transfer"]);
    expect(to.events.map((event) => event.payload.kind).sort()).toEqual([
      "alta",
      "transfer",
    ]);
    expect(to.events.every((event) => event.companyId === b.companyId)).toBe(
      true,
    );

    // Audited in both companies.
    const audits = await ownerDb
      .select({ companyId: auditEvents.companyId, action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.resourceId, to.person.id));
    expect(audits).toContainEqual({
      companyId: b.companyId,
      action: "traslado",
    });

    // The group timeline reads both rows as one history, newest first.
    const timeline = await listGroupTimeline(
      await loadGroupReader(hr.id),
      a.companyId,
      person.id,
    );
    expect(timeline!.rows.map((row) => [row.companyId, row.visible])).toEqual([
      [a.companyId, true],
      [b.companyId, true],
    ]);
    const names = new Map(
      timeline!.rows.map((row) => [row.companyId, row.companyName]),
    );
    const employment = timeline!.events
      .filter((event) => event.type === "employment")
      .map((event) => [event.companyId, describeGroupEvent(event, names)]);
    expect(employment).toEqual(
      expect.arrayContaining([
        [b.companyId, "Ingreso"],
        [b.companyId, `Llega por traslado desde ${a.company.name}`],
        [a.companyId, `Se traslada a ${b.company.name}`],
        [a.companyId, "Baja · Traslado a otra empresa del grupo"],
      ]),
    );
    // The fixture's period predates W2-13, so A has no ingreso event: the
    // baja the day before the transfer is the oldest.
    expect(employment.at(-1)).toEqual([
      a.companyId,
      "Baja · Traslado a otra empresa del grupo",
    ]);
    const dates = timeline!.events.map((event) => event.occurredAt.getTime());
    expect([...dates].sort((x, y) => y - x)).toEqual(dates);

    // Keyset pages across both companies never repeat or skip an event.
    const first = await listGroupTimeline(
      await loadGroupReader(hr.id),
      b.companyId,
      to.person.id,
      { limit: 2 },
    );
    const rest = await listGroupTimeline(
      await loadGroupReader(hr.id),
      b.companyId,
      to.person.id,
      { limit: 200, before: first!.next },
    );
    expect(
      [...first!.events, ...rest!.events].map((event) => event.id),
    ).toEqual(timeline!.events.map((event) => event.id));

    // Someone who reads only company A sees B as a name, never its events.
    const partial = await listGroupTimeline(
      await loadGroupReader(reader.id),
      a.companyId,
      person.id,
    );
    expect(partial!.rows[1]).toMatchObject({
      companyId: b.companyId,
      visible: false,
      person: null,
    });
    expect(
      partial!.events.every((event) => event.companyId === a.companyId),
    ).toBe(true);

    // The group admin grant reads every company, still per company.
    await ownerDb
      .update(users)
      .set({ isGroupAdmin: true })
      .where(eq(users.id, reader.id));
    const granted = await listGroupTimeline(
      await loadGroupReader(reader.id),
      a.companyId,
      person.id,
    );
    expect(granted!.events.map((event) => event.id)).toEqual(
      timeline!.events.map((event) => event.id),
    );
    await ownerDb
      .update(users)
      .set({ isGroupAdmin: false })
      .where(eq(users.id, reader.id));

    // Transferred back: A's baja row (same CURP) reopens, seniority still kept.
    const back = await transferPerson(
      b.companyId,
      to.person.id,
      { toCompanyId: a.companyId, fechaTraslado: "2027-02-01" },
      hr.id,
    );
    expect(back).toMatchObject({
      toPersonId: person.id,
      reusedRow: true,
      fechaAntiguedad: "2020-03-01",
    });
    const again = await rowsOf(a.companyId, person.id);
    expect(again.person.status).toBe("activa");
    expect(again.periods).toHaveLength(2);
    expect(again.links.map((link) => link.direction).sort()).toEqual([
      "in",
      "out",
    ]);
  });

  it("refuses linking to a row whose CURP does not match, and writes nothing", async () => {
    const person = await hireInA(`curp-${Date.now()}@idor.test`);
    const before = await rowsOf(a.companyId, person.id);
    const teammate = await rowsOf(b.companyId, b.teammate.id);

    // b.teammate is de baja so only the CURP stands in the way.
    await ownerDb
      .update(people)
      .set({ status: "baja" })
      .where(eq(people.id, b.teammate.id));

    await expect(
      transferPerson(
        a.companyId,
        person.id,
        {
          toCompanyId: b.companyId,
          fechaTraslado: "2026-11-16",
          toPersonId: b.teammate.id,
        },
        hr.id,
      ),
    ).rejects.toEqual(
      new TransferError(TRANSFER_COPY.curpMismatch, "toPersonId"),
    );

    expect(await rowsOf(a.companyId, person.id)).toEqual(before);
    expect((await rowsOf(b.companyId, b.teammate.id)).links).toEqual(
      teammate.links,
    );
  });

  it("refuses when the person already works in the other company", async () => {
    // a.person and b.person share a CURP and both are active.
    await expect(
      transferPerson(
        a.companyId,
        a.person.id,
        { toCompanyId: b.companyId, fechaTraslado: "2026-11-16" },
        hr.id,
      ),
    ).rejects.toThrow(TRANSFER_COPY.alreadyActive);
    const [still] = await ownerDb
      .select()
      .from(people)
      .where(eq(people.id, a.person.id));
    expect(still.status).toBe("activa");
  });
});

describe("lib:transfers/listPersonLinks", () => {
  it("returns nothing of company A's person to company B", async () => {
    const person = await hireInA(`links-${Date.now()}@idor.test`);
    await transferPerson(
      a.companyId,
      person.id,
      { toCompanyId: b.companyId, fechaTraslado: "2026-12-01" },
      hr.id,
    );

    expect(await listPersonLinks(a.companyId, person.id)).toHaveLength(1);
    expect(await listPersonLinks(b.companyId, person.id)).toEqual([]);
  });
});

describe("action:transfers/transferPersonAction", () => {
  it("action:transfers/transferPersonAction", async () => {
    const person = await hireInA(`accion-${Date.now()}@idor.test`);
    const before = await rowsOf(a.companyId, person.id);

    // Company B's admin, in B, aims at A's person: not found, nothing moves.
    actAs(b.admin, b.companyId);
    expect(
      await transferPersonAction(
        person.id,
        {},
        formData({
          companyId: b.companyId,
          toCompanyId: a.companyId,
          fechaTraslado: "2026-11-16",
        }),
      ),
    ).toEqual({ error: TRANSFER_COPY.denied });
    expect(await rowsOf(a.companyId, person.id)).toEqual(before);

    // HR in both companies: transferred, back to the expediente.
    actAs(hr, a.companyId);
    await expect(
      transferPersonAction(
        person.id,
        {},
        formData({
          companyId: a.companyId,
          toCompanyId: b.companyId,
          fechaTraslado: "2026-11-16",
        }),
      ),
    ).rejects.toEqual(
      new NavigationThrow(
        "redirect",
        `/app/personas/${person.id}?traslado=1&invitacion=1`,
      ),
    );
    expect((await rowsOf(a.companyId, person.id)).person.status).toBe("baja");
  });

  it("rbac:action:transfers/transferPersonAction", async () => {
    const person = await hireInA(`rbac-${Date.now()}@idor.test`);
    const before = await rowsOf(a.companyId, person.id);
    const form = formData({
      companyId: a.companyId,
      toCompanyId: b.companyId,
      fechaTraslado: "2026-11-16",
    });

    // No people:transfer in A.
    actAs(a.viewer, a.companyId);
    expect(await transferPersonAction(person.id, {}, form)).toEqual({
      error: TRANSFER_COPY.denied,
    });
    // people:transfer in A, but no membership in B.
    actAs(a.admin, a.companyId);
    expect(await transferPersonAction(person.id, {}, form)).toEqual({
      error: TRANSFER_COPY.denied,
    });
    expect(await rowsOf(a.companyId, person.id)).toEqual(before);
  });
});

describe("action:transfers/setGroupAdminAction", () => {
  it("action:transfers/setGroupAdminAction", async () => {
    const platform = await newUser(`plataforma-${Date.now()}@idor.test`);
    await ownerDb
      .update(users)
      .set({ isPlatformAdmin: true })
      .where(eq(users.id, platform.id));
    actAs(platform);

    expect(
      await setGroupAdminAction(
        {},
        formData({ email: reader.email, grant: "1" }),
      ),
    ).toMatchObject({ notice: expect.any(String) });
    expect((await loadGroupReader(reader.id)).isGroupAdmin).toBe(true);
    await setGroupAdminAction(
      {},
      formData({ email: reader.email, grant: "0" }),
    );
    expect((await loadGroupReader(reader.id)).isGroupAdmin).toBe(false);
  });

  it("rbac:action:transfers/setGroupAdminAction", async () => {
    actAs(a.admin, a.companyId);
    expect(
      await setGroupAdminAction(
        {},
        formData({ email: a.admin.email, grant: "1" }),
      ),
    ).toEqual({ error: "No tienes permiso para hacer este cambio." });
    expect((await loadGroupReader(a.admin.id)).isGroupAdmin).toBe(false);
  });
});
