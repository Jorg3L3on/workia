/**
 * Vacation days taken (WRK-I14-3) and the annual constancia (WRK-I14-4).
 * Company B cannot read, create or void company A's records, and a role
 * without vacations:create is denied. The constancia page answers notFound
 * without vacations:read or without contracts:read, and notFound for a
 * person of the other company. Titles are the surface ids in docs/idor-matrix.md.
 */
import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";

import VacationConstanciaPage from "@/app/app/personas/[id]/vacaciones/constancia/page";
import {
  auditEvents,
  companies,
  companyMemberships,
  employmentPeriods,
  people,
  permissions,
  rolePermissions,
  roles,
  users,
  vacationRecords,
} from "@/lib/db/schema";
import { formatDateMx, isoToday } from "@/lib/format/date";
import {
  vacationPeriodFor,
  vacationPeriodForCompletedYear,
} from "@/lib/people/vacation";
import { STALE_COMPANY_MESSAGE } from "@/lib/tenant/scope";
import {
  formatSignedVacationDays,
  serviceYearBalance,
  VACATION_COPY,
} from "@/lib/vacations/balance";
import { getVacationConstancia } from "@/lib/vacations/constancia";
import {
  listVacationRecords,
  registerVacationRecord,
  voidVacationRecord,
} from "@/lib/vacations";
import {
  registerVacationAction,
  voidVacationAction,
} from "@/lib/vacations/actions";

import { idsIn, ownerDb, seedTenant, type Tenant } from "./fixtures";
import { actAs, NavigationThrow } from "./session-state";

let a: Tenant;
let b: Tenant;
let recordA: { id: string };

const formData = (values: Record<string, string>) => {
  const data = new FormData();

  for (const [key, value] of Object.entries(values)) {
    data.set(key, value);
  }

  return data;
};

const rowsOf = (companyId: string) =>
  ownerDb
    .select()
    .from(vacationRecords)
    .where(eq(vacationRecords.companyId, companyId));

const hire = async (tenant: Tenant) => {
  await ownerDb
    .update(people)
    .set({ fechaIngreso: "2023-03-01" })
    .where(eq(people.id, tenant.person.id));
  await ownerDb.insert(employmentPeriods).values({
    companyId: tenant.companyId,
    personId: tenant.person.id,
    fechaIngreso: "2023-03-01",
    fechaAntiguedad: "2023-03-01",
  });
};

beforeAll(async () => {
  a = await seedTenant("VA");
  b = await seedTenant("VB");
  await hire(a);
  await hire(b);

  const created = await registerVacationRecord(
    a.companyId,
    {
      personId: a.person.id,
      startDate: "2026-06-10",
      endDate: "2026-06-14",
      days: "5",
      note: "Semana de junio",
    },
    a.admin.id,
  );

  if (!created || !created.ok) {
    throw new Error("No se pudo preparar el registro de la empresa A.");
  }

  recordA = { id: created.id };
});

describe("vacation records stay inside the company", () => {
  it("lib:vacations/listVacationRecords", async () => {
    expect(
      idsIn(await listVacationRecords(b.companyId, a.person.id)),
    ).not.toContain(recordA.id);
    expect(
      (await listVacationRecords(a.companyId, a.person.id)).map(
        (row) => row.id,
      ),
    ).toContain(recordA.id);

    const balance = serviceYearBalance({
      serviceYear: 3,
      entitlementDays: 16,
      entries: (await listVacationRecords(a.companyId, a.person.id)).map(
        (row) => ({
          serviceYear: row.serviceYear,
          days: row.days,
          voided: false,
        }),
      ),
    });

    expect(balance.takenHalves / 2).toBe(5);
    expect(balance.remainingHalves / 2).toBe(11);
  });

  it("lib:vacations/registerVacationRecord", async () => {
    const before = await rowsOf(a.companyId);

    expect(
      await registerVacationRecord(b.companyId, {
        personId: a.person.id,
        startDate: "2026-07-01",
        endDate: "2026-07-02",
        days: "1",
      }),
    ).toBeNull();
    expect(await rowsOf(a.companyId)).toEqual(before);

    const overlap = await registerVacationRecord(a.companyId, {
      personId: a.person.id,
      startDate: "2026-06-12",
      endDate: "2026-06-13",
      days: "1",
    });

    expect(overlap).toEqual({ ok: false, error: VACATION_COPY.overlap });

    const zero = await registerVacationRecord(a.companyId, {
      personId: a.person.id,
      startDate: "2026-09-01",
      endDate: "2026-09-02",
      days: "0",
    });

    expect(zero).toEqual({ ok: false, error: VACATION_COPY.days });

    const backwards = await registerVacationRecord(a.companyId, {
      personId: a.person.id,
      startDate: "2026-09-05",
      endDate: "2026-09-01",
      days: "1",
    });

    expect(backwards).toEqual({
      ok: false,
      error: VACATION_COPY.endBeforeStart,
    });

    const stepped = await registerVacationRecord(a.companyId, {
      personId: a.person.id,
      startDate: "2026-09-01",
      endDate: "2026-09-01",
      days: "0.3",
    });

    expect(stepped).toEqual({ ok: false, error: VACATION_COPY.days });

    const over = await registerVacationRecord(
      a.companyId,
      {
        personId: a.person.id,
        startDate: "2026-08-03",
        endDate: "2026-08-07",
        days: "12",
      },
      a.admin.id,
    );

    expect(over).toMatchObject({
      ok: true,
      warning: VACATION_COPY.over,
    });

    const stored = (await rowsOf(a.companyId)).find(
      (row) => row.id === recordA.id,
    );

    expect(stored).toMatchObject({
      companyId: a.companyId,
      personId: a.person.id,
      serviceYear: 3,
      days: "5.0",
      voidedAt: null,
    });
    expect(stored?.employmentPeriodId).toEqual(expect.any(String));
  });

  it("lib:vacations/voidVacationRecord", async () => {
    const created = await registerVacationRecord(
      a.companyId,
      {
        personId: a.person.id,
        startDate: "2024-04-01",
        endDate: "2024-04-02",
        days: "0.5",
      },
      a.admin.id,
    );

    if (!created || !created.ok) {
      throw new Error("No se pudo preparar el registro a anular.");
    }

    const before = await rowsOf(a.companyId);

    expect(
      await voidVacationRecord(b.companyId, created.id, b.admin.id),
    ).toBeNull();
    expect(await rowsOf(a.companyId)).toEqual(before);

    const voided = await voidVacationRecord(
      a.companyId,
      created.id,
      a.admin.id,
    );

    expect(voided).toMatchObject({ ok: true, id: created.id });
    expect(
      (await listVacationRecords(a.companyId, a.person.id)).map(
        (row) => row.id,
      ),
    ).not.toContain(created.id);

    const [row] = await ownerDb
      .select()
      .from(vacationRecords)
      .where(eq(vacationRecords.id, created.id));

    expect(row?.voidedAt).toBeInstanceOf(Date);
    expect(await rowsOf(a.companyId)).toHaveLength(before.length);

    const events = await ownerDb
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.resourceId, created.id));

    expect(events.map((event) => event.action).sort()).toEqual([
      "create",
      "delete",
    ]);
    expect(
      events.every((event) => event.resourceType === "vacation_record"),
    ).toBe(true);

    const again = await registerVacationRecord(a.companyId, {
      personId: a.person.id,
      startDate: "2024-04-01",
      endDate: "2024-04-02",
      days: "0.5",
    });

    expect(again).toMatchObject({ ok: true, warning: null });
  });
});

describe("vacation actions with company B's session", () => {
  it("action:vacations/registerVacationAction", async () => {
    const before = await rowsOf(a.companyId);

    actAs(b.admin);
    expect(
      await registerVacationAction(
        {},
        formData({
          companyId: a.companyId,
          personId: a.person.id,
          startDate: "2026-10-01",
          endDate: "2026-10-02",
          days: "1",
        }),
      ),
    ).toEqual({ error: STALE_COMPANY_MESSAGE });
    expect(
      await registerVacationAction(
        {},
        formData({
          personId: a.person.id,
          startDate: "2026-10-01",
          endDate: "2026-10-02",
          days: "1",
        }),
      ),
    ).toEqual({ error: VACATION_COPY.personNotFound });
    expect(await rowsOf(a.companyId)).toEqual(before);
  });

  it("action:vacations/voidVacationAction", async () => {
    const before = await rowsOf(a.companyId);

    actAs(b.admin);
    expect(
      await voidVacationAction(
        {},
        formData({ companyId: a.companyId, recordId: recordA.id }),
      ),
    ).toEqual({ error: STALE_COMPANY_MESSAGE });
    expect(
      await voidVacationAction({}, formData({ recordId: recordA.id })),
    ).toEqual({ error: VACATION_COPY.notFound });

    const [row] = await ownerDb
      .select()
      .from(vacationRecords)
      .where(eq(vacationRecords.id, recordA.id));

    expect(row?.voidedAt).toBeNull();
    expect(await rowsOf(a.companyId)).toEqual(before);
  });
});

describe("vacation permissions", () => {
  it("rbac:action:vacations/registerVacationAction", async () => {
    const before = await rowsOf(b.companyId);

    actAs(b.viewer);
    expect(
      await registerVacationAction(
        {},
        formData({
          personId: b.person.id,
          startDate: "2025-05-01",
          endDate: "2025-05-02",
          days: "1",
        }),
      ),
    ).toEqual({ error: VACATION_COPY.deniedCreate });
    expect(await rowsOf(b.companyId)).toEqual(before);

    actAs(b.editor);
    expect(
      await registerVacationAction(
        {},
        formData({
          personId: b.person.id,
          startDate: "2025-05-01",
          endDate: "2025-05-02",
          days: "1",
        }),
      ),
    ).toMatchObject({ ok: true });
  });

  it("rbac:action:vacations/voidVacationAction", async () => {
    const created = await registerVacationRecord(
      b.companyId,
      {
        personId: b.person.id,
        startDate: "2025-06-01",
        endDate: "2025-06-02",
        days: "1",
      },
      b.admin.id,
    );

    if (!created || !created.ok) {
      throw new Error("No se pudo preparar el registro de la empresa B.");
    }

    actAs(b.viewer);
    expect(
      await voidVacationAction({}, formData({ recordId: created.id })),
    ).toEqual({ error: VACATION_COPY.deniedVoid });

    const [still] = await ownerDb
      .select()
      .from(vacationRecords)
      .where(eq(vacationRecords.id, created.id));

    expect(still?.voidedAt).toBeNull();

    actAs(b.editor);
    expect(
      await voidVacationAction(
        {},
        formData({ recordId: created.id, personId: b.person.id }),
      ),
    ).toEqual({ ok: true });
  });
});

describe("vacation_records constraints", () => {
  it("rejects a cross-company person, a non half-day, and keeps the index and policy", async () => {
    await expect(
      ownerDb.execute(sql`
        INSERT INTO vacation_records (
          company_id, person_id, service_year, start_date, end_date, days
        ) VALUES (
          ${b.companyId}, ${a.person.id}, 1, '2026-01-01', '2026-01-02', 1
        )
      `),
    ).rejects.toThrow();

    await expect(
      ownerDb.execute(sql`
        INSERT INTO vacation_records (
          company_id, person_id, service_year, start_date, end_date, days
        ) VALUES (
          ${a.companyId}, ${a.person.id}, 1, '2024-02-01', '2024-02-01', 0.3
        )
      `),
    ).rejects.toThrow();

    const indexes = await ownerDb.execute<{ indexname: string }>(sql`
      SELECT indexname FROM pg_indexes WHERE tablename = 'vacation_records'
    `);
    const policies = await ownerDb.execute<{ policyname: string }>(sql`
      SELECT policyname FROM pg_policies WHERE tablename = 'vacation_records'
    `);

    expect(indexes.rows.map((row) => row.indexname)).toContain(
      "vacation_records_company_person_start_idx",
    );
    expect(policies.rows.map((row) => row.policyname)).toContain(
      "vacation_records_company_isolation",
    );
  });
});

const plusDays = (iso: string, days: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));

  return date.toISOString().slice(0, 10);
};

const hireForConstancia = async (tenant: Tenant, fechaIngreso: string) => {
  await ownerDb
    .update(people)
    .set({ fechaIngreso })
    .where(eq(people.id, tenant.person.id));
  await ownerDb.insert(employmentPeriods).values({
    companyId: tenant.companyId,
    personId: tenant.person.id,
    fechaIngreso,
    fechaAntiguedad: fechaIngreso,
  });
};

const openConstancia = (personId: string, anio?: string) =>
  VacationConstanciaPage({
    params: Promise.resolve({ id: personId }),
    searchParams: Promise.resolve(anio === undefined ? {} : { anio }),
  });

describe("vacation constancia stays inside the company", () => {
  let companyA: Tenant;
  let companyB: Tenant;
  let serviceYear: number;
  const seniority = "2023-03-01";

  beforeAll(async () => {
    companyA = await seedTenant("VC");
    companyB = await seedTenant("VD");
    const today = isoToday();
    const current = vacationPeriodFor(seniority, today);

    if (!current || current.proportionalOnly) {
      throw new Error("La fixture no tiene un año de servicio cumplido.");
    }

    serviceYear = current.serviceYearsCompleted;
    await ownerDb
      .update(companies)
      .set({ legalName: "Empresa Demostración SA" })
      .where(eq(companies.id, companyA.companyId));
    await hireForConstancia(companyA, seniority);
    await hireForConstancia(companyB, seniority);

    const created = await registerVacationRecord(companyA.companyId, {
      personId: companyA.person.id,
      startDate: current.currentAnniversary,
      endDate: current.currentAnniversary,
      days: "5",
    });
    const voided = await registerVacationRecord(companyA.companyId, {
      personId: companyA.person.id,
      startDate: plusDays(current.currentAnniversary, 1),
      endDate: plusDays(current.currentAnniversary, 1),
      days: "1",
    });

    if (!created?.ok || !voided?.ok) {
      throw new Error("No se pudo preparar el registro de la empresa A.");
    }

    const removed = await voidVacationRecord(companyA.companyId, voided.id);

    if (!removed?.ok) {
      throw new Error("No se pudo anular el registro de la empresa A.");
    }

    if (serviceYear < 2) {
      return;
    }

    const previous = vacationPeriodForCompletedYear(seniority, serviceYear - 1);

    if (!previous) {
      throw new Error("No se pudo ubicar el año de servicio anterior.");
    }

    const otherYear = await registerVacationRecord(companyA.companyId, {
      personId: companyA.person.id,
      startDate: previous.currentAnniversary,
      endDate: previous.currentAnniversary,
      days: "2",
    });

    if (!otherYear?.ok) {
      throw new Error("No se pudo registrar el año de servicio anterior.");
    }
  });

  it("lib:vacations/constancia/getVacationConstancia", async () => {
    expect(
      await getVacationConstancia(
        companyB.companyId,
        companyA.person.id,
        isoToday(),
        serviceYear,
      ),
    ).toBeNull();

    const sheet = await getVacationConstancia(
      companyA.companyId,
      companyA.person.id,
      isoToday(),
      serviceYear,
    );
    const period = vacationPeriodForCompletedYear(seniority, serviceYear);

    expect(sheet).toMatchObject({
      companyName: "Empresa Demostración SA",
      personName: `Persona ${companyA.label} Idor`,
      seniorityDate: seniority,
      serviceYear,
      entitlementDays: period?.entitlementDays,
      takenHalves: 10,
      grantBy: period?.grantBy,
    });
    expect(sheet?.ranges).toEqual([
      {
        startDate: period!.currentAnniversary,
        endDate: period!.currentAnniversary,
        days: "5.0",
      },
    ]);
  });

  it("prints the sheet for the company and hides it from everyone else", async () => {
    const period = vacationPeriodForCompletedYear(seniority, serviceYear);

    actAs(companyB.admin);
    await expect(
      openConstancia(companyA.person.id, String(serviceYear)),
    ).rejects.toMatchObject({ kind: "notFound" });

    actAs(companyA.viewer);
    await expect(
      openConstancia(companyA.person.id, String(serviceYear)),
    ).rejects.toBeInstanceOf(NavigationThrow);
    await expect(
      openConstancia(companyA.person.id, String(serviceYear)),
    ).rejects.toMatchObject({ kind: "notFound" });

    actAs(companyA.admin);
    await expect(openConstancia(companyA.person.id, "0")).rejects.toMatchObject(
      { kind: "notFound" },
    );
    await expect(
      openConstancia(companyA.person.id, String(serviceYear + 20)),
    ).rejects.toMatchObject({ kind: "notFound" });

    const html = renderToStaticMarkup(
      await openConstancia(companyA.person.id, String(serviceYear)),
    );

    expect(html).toContain("Empresa Demostración SA");
    expect(html).toContain(`Persona ${companyA.label} Idor`);
    expect(html).toContain(formatDateMx(seniority));
    expect(html).toContain(`>${serviceYear}</dd>`);
    expect(html).toContain(
      formatSignedVacationDays((period?.entitlementDays ?? 0) * 2),
    );
    expect(html).toContain("5 días");
    expect(html).toContain(formatDateMx(period?.grantBy));
    expect(html).toContain("Nombre y firma de quien expide");
    expect(html).toContain("Firma de la persona trabajadora");
    expect(html).toContain("print:hidden");
    expect(html).not.toMatch(/Art\.\s*81|artículo 81|prima vacacional/i);
    expect(html).not.toContain(
      formatDateMx(plusDays(period!.currentAnniversary, 1)),
    );
  });

  it("returns notFound with vacations:read and without contracts:read", async () => {
    const [role] = await ownerDb
      .insert(roles)
      .values({
        slug: `vacaciones-${randomUUID().slice(0, 8)}`,
        name: "Vacaciones",
      })
      .returning();
    const granted = (await ownerDb.select().from(permissions)).filter(
      (permission) =>
        permission.slug === "people:read" ||
        permission.slug === "vacations:read",
    );

    await ownerDb.insert(rolePermissions).values(
      granted.map((permission) => ({
        roleId: role.id,
        permissionId: permission.id,
      })),
    );

    const [user] = await ownerDb
      .insert(users)
      .values({
        email: `vacaciones-${role.slug}@idor.test`,
        name: "Vacaciones",
      })
      .returning();

    await ownerDb.insert(companyMemberships).values({
      userId: user.id,
      companyId: companyA.companyId,
      roleId: role.id,
      isDefault: true,
    });

    actAs(user);
    await expect(
      openConstancia(companyA.person.id, String(serviceYear)),
    ).rejects.toMatchObject({ kind: "notFound" });
  });
});
