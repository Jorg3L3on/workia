/**
 * PDF of a contract (WRK-12): the file is the stored text plus the schedule
 * annex, company B cannot read company A's contract, and the route needs
 * both contracts:read and compensation:read.
 */
import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { GET as pdfRoute } from "@/app/app/personas/[id]/contratos/[contractId]/pdf/route";
import {
  auditEvents,
  companyMemberships,
  contracts,
  permissions,
  rolePermissions,
  roles,
  users,
} from "@/lib/db/schema";
import { contractScheduleText } from "@/lib/contracts/schema";
import { extractPdfText } from "@/test/pdf-text";

import { ownerDb, seedTenant, type Tenant } from "./fixtures";
import { actAs } from "./session-state";

let a: Tenant;
let b: Tenant;

const generatedText = [
  "Contrato de prueba con acentos áéíóú, eñe ñ, signo № y letra Ł.",
  "",
  "Este párrafo es deliberadamente largo para ocupar más de un renglón y conservar cada palabra, el espacio y la eñe ñ al imprimirse.",
  "Periodo de prueba de 30 días.",
].join("\n");

const pdfUrl = (personId: string, contractId: string) =>
  `http://test/app/personas/${personId}/contratos/${contractId}/pdf`;

const callPdf = (personId: string, contractId: string) =>
  pdfRoute(new Request(pdfUrl(personId, contractId)), {
    params: Promise.resolve({ id: personId, contractId }),
  });

beforeAll(async () => {
  a = await seedTenant("A");
  b = await seedTenant("B");
});

describe("contract PDF stays inside the company", () => {
  it("route:GET /app/personas/[id]/contratos/[contractId]/pdf", async () => {
    const [contract] = await ownerDb
      .insert(contracts)
      .values({
        companyId: a.companyId,
        personId: a.person.id,
        type: "determinado",
        startDate: "2026-03-01",
        endDate: "2026-12-31",
        noticeWindow: "no_avisar",
        templateName: "Plantilla de prueba",
        generatedText,
        scheduleEntrada: "08:00",
        scheduleSalida: "17:00",
        scheduleBlocks: [
          {
            dias: ["lun", "mie", "vie"],
            entrada: "08:00",
            salida: "17:00",
            comidaInicio: null,
            comidaFin: null,
          },
        ],
        scheduleRestDay: "sab",
      })
      .returning();
    const schedule = contractScheduleText(contract);

    actAs(b.admin);
    const foreign = await callPdf(a.person.id, contract.id);
    expect(foreign.status).toBe(404);

    actAs(a.admin);
    const wrongPerson = await callPdf(a.teammate.id, contract.id);
    expect(wrongPerson.status).toBe(404);

    const response = await callPdf(a.person.id, contract.id);
    const bytes = Buffer.from(await response.arrayBuffer());
    const extracted = extractPdfText(bytes);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe(
      `attachment; filename="contrato-${contract.id.slice(0, 8)}.pdf"`,
    );
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(extracted).toBe(
      `${contract.generatedText}\n\nANEXO A. HORARIO\n\n${schedule}`,
    );
    expect(extracted).toContain("áéíóú");
    expect(extracted).toContain("ñ");
    expect(extracted).toContain("Mié");

    const exports = await ownerDb
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.companyId, a.companyId),
          eq(auditEvents.resourceType, "contract"),
          eq(auditEvents.resourceId, contract.id),
          eq(auditEvents.action, "export"),
        ),
      );

    expect(exports).toHaveLength(1);
    expect(exports[0]).toMatchObject({
      actorUserId: a.admin.id,
      action: "export",
      resourceType: "contract",
    });
  });

  it("rbac:route:GET /app/personas/[id]/contratos/[contractId]/pdf", async () => {
    const [role] = await ownerDb
      .insert(roles)
      .values({
        slug: `compensacion-${randomUUID().slice(0, 8)}`,
        name: "Compensacion",
      })
      .returning();
    const granted = (await ownerDb.select().from(permissions)).filter(
      (permission) => permission.slug === "compensation:read",
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
        email: `compensacion-${role.slug}@idor.test`,
        name: "Compensacion",
      })
      .returning();

    await ownerDb.insert(companyMemberships).values({
      userId: user.id,
      companyId: b.companyId,
      roleId: role.id,
      isDefault: true,
    });

    const before = await ownerDb
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.resourceId, b.contract.id),
          eq(auditEvents.action, "export"),
        ),
      );

    // contracts:read without compensation:read.
    actAs(b.viewer);
    expect((await callPdf(b.person.id, b.contract.id)).status).toBe(403);

    // compensation:read without contracts:read.
    actAs(user);
    expect((await callPdf(b.person.id, b.contract.id)).status).toBe(403);

    const after = await ownerDb
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.resourceId, b.contract.id),
          eq(auditEvents.action, "export"),
        ),
      );

    expect(after).toHaveLength(before.length);
  });

  it("rejects glyphs the font cannot draw instead of dropping them", async () => {
    const [contract] = await ownerDb
      .insert(contracts)
      .values({
        companyId: a.companyId,
        personId: a.person.id,
        type: "indeterminado",
        startDate: "2026-04-01",
        noticeWindow: "no_avisar",
        generatedText: "Cláusula con ✓ y 李.",
      })
      .returning();

    actAs(a.admin);
    const response = await callPdf(a.person.id, contract.id);
    const body = await response.text();

    expect(response.status).toBe(422);
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(body).toContain("✓");
    expect(body).toContain("李");
    expect(body).not.toContain("%PDF");

    const exports = await ownerDb
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.resourceId, contract.id),
          eq(auditEvents.action, "export"),
        ),
      );

    expect(exports).toHaveLength(0);
  });

  it("answers 404 when the contract id is not a uuid", async () => {
    actAs(a.admin);
    const response = await callPdf(a.person.id, "no-es-uuid");

    expect(response.status).toBe(404);
  });
});
