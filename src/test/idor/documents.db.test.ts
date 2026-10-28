/**
 * Document requirements and delivery dates (WRK-I15-1). Company B cannot
 * read or write company A's rows, and a role without documents:manage is
 * denied. Test titles are the surface ids of docs/idor-matrix.md.
 */
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { onboardingChecklistLabels } from "@/lib/onboarding/schema";
import { documentRequirements, personDocuments } from "@/lib/db/schema";
import {
  recordDeliveryAction,
  setRequirementsAction,
} from "@/lib/documents/actions";
import {
  activateDocumentRequirements,
  getDocumentRequirementById,
  listDocumentRequirements,
  listPersonDocuments,
  recordDelivery,
  setRequirements,
} from "@/lib/documents";
import { DEFAULT_DOCUMENT_REQUIREMENTS } from "@/lib/documents/schema";
import { STALE_COMPANY_MESSAGE } from "@/lib/tenant/scope";

import { idsIn, ownerDb, seedTenant, type Tenant } from "./fixtures";
import { actAs } from "./session-state";

let a: Tenant;
let b: Tenant;
let requirementA: { id: string; name: string };
let requirementB: { id: string };
let deliveryA: { id: string; deliveredOn: string; expiresOn: string | null };

const item = (
  name: string,
  extra: {
    required?: boolean;
    validityMonths?: number | null;
    sort?: number;
  } = {},
) => ({
  name,
  required: extra.required ?? true,
  validityMonths: extra.validityMonths ?? null,
  sort: extra.sort ?? 0,
  active: true,
});

const formData = (values: Record<string, string>) => {
  const data = new FormData();

  for (const [key, value] of Object.entries(values)) {
    data.set(key, value);
  }

  return data;
};

const requirementsOf = (companyId: string) =>
  ownerDb
    .select()
    .from(documentRequirements)
    .where(eq(documentRequirements.companyId, companyId));

const deliveriesOf = (companyId: string) =>
  ownerDb
    .select()
    .from(personDocuments)
    .where(eq(personDocuments.companyId, companyId));

beforeAll(async () => {
  a = await seedTenant("DA");
  b = await seedTenant("DB");
  const saved = await setRequirements(
    a.companyId,
    {
      positionId: null,
      requirements: [item("Identificación"), item("Domicilio", { sort: 1 })],
    },
    a.admin.id,
  );

  if (!saved) {
    throw new Error("No se pudo preparar el requisito de la empresa A.");
  }

  requirementA = saved[0];
  const savedB = await setRequirements(
    b.companyId,
    { positionId: null, requirements: [item("Comprobante")] },
    b.admin.id,
  );

  if (!savedB) {
    throw new Error("No se pudo preparar el requisito de la empresa B.");
  }

  requirementB = savedB[0];
  const delivery = await recordDelivery(
    a.companyId,
    {
      personId: a.person.id,
      requirementId: requirementA.id,
      deliveredOn: "2026-01-15",
      expiresOn: "2026-12-31",
    },
    a.admin.id,
  );

  if (!delivery) {
    throw new Error("No se pudo preparar la entrega de la empresa A.");
  }

  deliveryA = delivery;
});

describe("documents stay inside the company", () => {
  it("lib:documents/activateDocumentRequirements", async () => {
    const fresh = await seedTenant("DC");
    const beforeA = (await requirementsOf(a.companyId)).length;
    const seeded = await activateDocumentRequirements(
      fresh.companyId,
      fresh.admin.id,
    );

    expect(seeded.map((row) => row.name)).toEqual(
      DEFAULT_DOCUMENT_REQUIREMENTS.map((row) => row.name),
    );
    expect(seeded.every((row) => row.companyId === fresh.companyId)).toBe(true);
    expect(idsIn(seeded)).not.toContain(requirementA.id);
    expect(
      seeded.find(
        (row) => row.name === onboardingChecklistLabels.constancia_fiscal,
      )?.required,
    ).toBe(false);
    expect(
      seeded.find(
        (row) => row.name === onboardingChecklistLabels.cuenta_bancaria,
      )?.required,
    ).toBe(false);
    expect(await activateDocumentRequirements(fresh.companyId)).toHaveLength(
      seeded.length,
    );
    expect((await requirementsOf(a.companyId)).length).toBe(beforeA);
  });

  it("lib:documents/listDocumentRequirements", async () => {
    const rows = await listDocumentRequirements(b.companyId);

    expect(idsIn(rows)).not.toContain(requirementA.id);
    expect(
      (await listDocumentRequirements(a.companyId)).map((row) => row.id),
    ).toContain(requirementA.id);
  });

  it("lib:documents/getDocumentRequirementById", async () => {
    expect(
      await getDocumentRequirementById(b.companyId, requirementA.id),
    ).toBeNull();
    expect(
      await getDocumentRequirementById(a.companyId, requirementA.id),
    ).toMatchObject({ id: requirementA.id, name: "Identificación" });
  });

  it("lib:documents/listPersonDocuments", async () => {
    expect(await listPersonDocuments(b.companyId, a.person.id)).toEqual([]);
    expect(
      (await listPersonDocuments(a.companyId, a.person.id)).map(
        (row) => row.id,
      ),
    ).toContain(deliveryA.id);
  });

  it("lib:documents/setRequirements", async () => {
    expect(
      await setRequirements(b.companyId, {
        positionId: a.position.id,
        requirements: [item("Ajeno")],
      }),
    ).toBeNull();
    expect(
      await setRequirements(b.companyId, {
        positionId: null,
        requirements: [
          {
            id: requirementA.id,
            name: "Robado",
            required: true,
            validityMonths: null,
            sort: 0,
            active: true,
          },
        ],
      }),
    ).toBeNull();
    expect(
      (await requirementsOf(a.companyId)).find(
        (row) => row.id === requirementA.id,
      )?.name,
    ).toBe("Identificación");
    expect(
      (await requirementsOf(b.companyId)).map((row) => row.name),
    ).not.toContain("Ajeno");
    expect(
      (await requirementsOf(b.companyId)).map((row) => row.name),
    ).not.toContain("Robado");
  });

  it("lib:documents/recordDelivery", async () => {
    const beforeA = await deliveriesOf(a.companyId);
    const beforeB = await deliveriesOf(b.companyId);

    expect(
      await recordDelivery(b.companyId, {
        personId: a.person.id,
        requirementId: requirementA.id,
        deliveredOn: "2026-03-01",
      }),
    ).toBeNull();
    expect(
      await recordDelivery(b.companyId, {
        personId: b.person.id,
        requirementId: requirementA.id,
        deliveredOn: "2026-03-01",
      }),
    ).toBeNull();
    expect(await deliveriesOf(a.companyId)).toEqual(beforeA);
    expect(await deliveriesOf(b.companyId)).toEqual(beforeB);
  });

  it("fills expires_on from validity months and refuses another position", async () => {
    const saved = await setRequirements(
      a.companyId,
      {
        positionId: a.position.id,
        requirements: [item("Credencial", { validityMonths: 12 })],
      },
      a.admin.id,
    );
    const requirement = saved?.[0];

    expect(requirement?.positionId).toBe(a.position.id);

    const delivery = await recordDelivery(a.companyId, {
      personId: a.person.id,
      requirementId: requirement!.id,
      deliveredOn: "2026-01-15",
    });

    expect(delivery).toMatchObject({
      companyId: a.companyId,
      expiresOn: "2027-01-15",
    });
    expect(
      await recordDelivery(a.companyId, {
        personId: a.teammate.id,
        requirementId: requirement!.id,
        deliveredOn: "2026-01-15",
      }),
    ).toBeNull();
    expect(
      (await deliveriesOf(b.companyId)).map((row) => row.requirementId),
    ).not.toContain(requirement!.id);
  });
});

describe("document actions with company B's session", () => {
  it("action:documents/setRequirementsAction", async () => {
    actAs(b.admin);
    expect(
      await setRequirementsAction(
        formData({
          companyId: a.companyId,
          payload: JSON.stringify({
            positionId: null,
            requirements: [item("Intruso")],
          }),
        }),
      ),
    ).toEqual({ error: STALE_COMPANY_MESSAGE });
    expect(
      (await requirementsOf(a.companyId)).map((row) => row.name),
    ).not.toContain("Intruso");

    expect(
      await setRequirementsAction(
        formData({
          payload: JSON.stringify({
            positionId: null,
            requirements: [
              {
                id: requirementA.id,
                name: "Robado",
                required: true,
                validityMonths: null,
                sort: 0,
                active: true,
              },
            ],
          }),
        }),
      ),
    ).toEqual({ error: "No encontramos ese registro en esta empresa." });
    expect(
      (await requirementsOf(a.companyId)).find(
        (row) => row.id === requirementA.id,
      )?.name,
    ).toBe("Identificación");
  });

  it("action:documents/recordDeliveryAction", async () => {
    actAs(b.admin);
    const before = await deliveriesOf(a.companyId);

    expect(
      await recordDeliveryAction(
        formData({
          companyId: a.companyId,
          personId: a.person.id,
          requirementId: requirementA.id,
          deliveredOn: "2026-04-01",
        }),
      ),
    ).toEqual({ error: STALE_COMPANY_MESSAGE });
    expect(
      await recordDeliveryAction(
        formData({
          personId: a.person.id,
          requirementId: requirementA.id,
          deliveredOn: "2026-04-01",
        }),
      ),
    ).toEqual({ error: "No encontramos ese registro en esta empresa." });
    expect(await deliveriesOf(a.companyId)).toEqual(before);
    expect(deliveryA.deliveredOn).toBe("2026-01-15");
  });
});

describe("documents permissions", () => {
  it("rbac:action:documents/setRequirementsAction", async () => {
    const namesBefore = (await requirementsOf(b.companyId)).map(
      (row) => row.name,
    );

    for (const user of [b.viewer, b.editor]) {
      actAs(user);
      expect(
        await setRequirementsAction(
          formData({
            payload: JSON.stringify({
              positionId: null,
              requirements: [item("Vista")],
            }),
          }),
        ),
      ).toEqual({ error: "No tienes permiso para gestionar documentos." });
    }

    expect((await requirementsOf(b.companyId)).map((row) => row.name)).toEqual(
      namesBefore,
    );
  });

  it("rbac:action:documents/recordDeliveryAction", async () => {
    const before = await deliveriesOf(b.companyId);

    for (const user of [b.viewer, b.editor]) {
      actAs(user);
      expect(
        await recordDeliveryAction(
          formData({
            personId: b.person.id,
            requirementId: requirementB.id,
            deliveredOn: "2026-05-01",
          }),
        ),
      ).toEqual({
        error: "No tienes permiso para gestionar documentos.",
      });
    }

    expect(await deliveriesOf(b.companyId)).toEqual(before);
  });
});

describe("person document indexes", () => {
  it("indexes company_id with person_id and with expires_on", async () => {
    const indexes = await ownerDb.execute<{ indexname: string }>(sql`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'person_documents'
    `);
    const columns = await ownerDb.execute<{ column_name: string }>(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'person_documents'
    `);
    const indexNames = indexes.rows.map((row) => row.indexname);
    const columnNames = columns.rows.map((row) => row.column_name);

    expect(indexNames).toEqual(
      expect.arrayContaining([
        "person_documents_company_person_idx",
        "person_documents_company_expires_on_idx",
      ]),
    );
    expect(columnNames).not.toContain("note");
    expect(columnNames).not.toContain("resultado");
    expect(columnNames).not.toContain("observaciones");
  });
});
