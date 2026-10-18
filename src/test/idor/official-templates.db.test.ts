/**
 * Official templates, new tokens and the seniority certificate (WRK-I5-5).
 * Test titles are the surface ids of docs/idor-matrix.md.
 */
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import {
  addOfficialTemplates,
  createContract,
  getSeniorityCertificate,
  listContractTemplates,
  previewContract,
  softDeleteContract,
} from "@/lib/contracts";
import { addOfficialTemplatesAction } from "@/lib/contracts/actions";
import { OFFICIAL_TEMPLATES } from "@/lib/contracts/official-templates";
import { companies, people } from "@/lib/db/schema";

import { ownerDb, seedTenant, type Tenant } from "./fixtures";
import { actAs } from "./session-state";

let a: Tenant;
let b: Tenant;

const formData = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

const redirectOf = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    return (error as { url?: string }).url ?? String(error);
  }
  return "no redirect";
};

const names = async (tenant: Tenant) =>
  (await listContractTemplates(tenant.companyId, true)).map((t) => t.name);

beforeAll(async () => {
  a = await seedTenant("OA");
  b = await seedTenant("OB");
});

describe("official templates", () => {
  it("lib:contracts/addOfficialTemplates", async () => {
    const created = await addOfficialTemplates(b.companyId, b.admin.id);
    expect(created).toHaveLength(2);
    expect(created.every((row) => row.companyId === b.companyId)).toBe(true);
    // Only B got them, and a second run adds nothing.
    expect(await names(a)).not.toContain(OFFICIAL_TEMPLATES[0].name);
    expect(await addOfficialTemplates(b.companyId, b.admin.id)).toEqual([]);
    expect(
      (await names(b)).filter((name) => name.includes("base oficial")),
    ).toHaveLength(2);
  });

  it("action:contracts/addOfficialTemplatesAction", async () => {
    actAs(b.admin);
    // A form opened in company A while the session is in B is refused.
    const url = await redirectOf(() =>
      addOfficialTemplatesAction(formData({ companyId: a.companyId })),
    );
    expect(url).toMatch(/error=company-changed/);
    expect(await names(a)).not.toContain(OFFICIAL_TEMPLATES[0].name);
  });

  it("rbac:action:contracts/addOfficialTemplatesAction", async () => {
    actAs(a.viewer);
    const url = await redirectOf(() =>
      addOfficialTemplatesAction(formData({ companyId: a.companyId })),
    );
    expect(url).toMatch(/error=create-permission/);
    expect(await names(a)).not.toContain(OFFICIAL_TEMPLATES[0].name);
  });

  it("emission fills the new tokens; the preview reports the empty ones", async () => {
    await ownerDb
      .update(companies)
      .set({ legalName: "Empresa OA SA de CV", rfc: "EOA010101AB1" })
      .where(eq(companies.id, a.companyId));
    await ownerDb
      .update(people)
      .set({
        curp: "DEMA900101MCSRNN09",
        fechaIngreso: "2023-03-15",
        domicilioCalle: "Calle 5",
        domicilioColonia: "Centro",
        domicilioMunicipio: "Tuxtla Gutiérrez",
        domicilioEstado: "Chiapas",
        domicilioCodigoPostal: "29000",
      })
      .where(eq(people.id, a.teammate.id));
    const [template] = await addOfficialTemplates(a.companyId, a.admin.id);

    const preview = await previewContract(a.companyId, {
      personId: a.teammate.id,
      templateId: template.id,
      type: "determinado",
      startDate: "2026-09-01",
      endDate: "2027-02-28",
    });
    expect(preview?.missingTokens).toEqual(
      expect.arrayContaining(["nss", "ine", "salario_diario", "forma_pago"]),
    );
    expect(preview?.missingTokens).not.toContain("curp");

    const contract = await createContract(
      a.companyId,
      {
        personId: a.teammate.id,
        templateId: template.id,
        type: "determinado",
        startDate: "2026-09-01",
        endDate: "2027-02-28",
        noticeWindow: "1",
        salarioDiario: 500,
        formaPago: "transferencia",
        periodicidadPago: "quincenal",
      },
      a.admin.id,
    );
    const text = contract.generatedText ?? "";
    expect(text).toContain("Empresa OA SA de CV");
    expect(text).toContain("RFC EOA010101AB1");
    expect(text).toContain("CURP DEMA900101MCSRNN09");
    expect(text).toContain(
      "domicilio en Calle 5, Col. Centro, Tuxtla Gutiérrez, Chiapas, C.P. 29000",
    );
    expect(text).toContain("salario diario de $500.00");
    expect(text).toContain("mensual aproximado de $15,200.00");
    expect(text).toContain(
      "pagadero en forma quincenal mediante transferencia",
    );
    expect(text).toContain("del 01/09/2026 al 28/02/2027");
    expect(text).not.toMatch(/\{\{\w+\}\}/);
    await softDeleteContract(a.companyId, contract.id, a.admin.id);
  });
});

describe("seniority certificate", () => {
  it("lib:contracts/getSeniorityCertificate", async () => {
    expect(
      await getSeniorityCertificate(b.companyId, a.person.id, "2026-10-17"),
    ).toBeNull();
  });

  it("shows the hire date, the seniority and the contracts", async () => {
    await ownerDb
      .update(people)
      .set({ fechaIngreso: "2024-01-10" })
      .where(eq(people.id, a.person.id));
    const certificate = await getSeniorityCertificate(
      a.companyId,
      a.person.id,
      "2026-10-17",
    );

    expect(certificate).toMatchObject({
      fechaIngreso: "2024-01-10",
      antiguedad: "2 años, 9 meses",
      contratos: [{ id: a.contract.id }],
    });
    expect(certificate?.text).toContain("ingresó a laborar el 10/01/2024");
    expect(certificate?.text).toContain("antigüedad de 2 años, 9 meses");
    expect(certificate?.text).toContain("Contratos:");
  });
});
