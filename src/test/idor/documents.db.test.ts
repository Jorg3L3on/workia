/**
 * Document requirements and delivery dates (WRK-I15-1). Company B cannot
 * read or write company A's rows, and a role without documents:manage is
 * denied. Test titles are the surface ids of docs/idor-matrix.md.
 */
import { eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { onboardingChecklistLabels } from "@/lib/onboarding/schema";
import { isUniqueViolation } from "@/lib/db/errors";
import {
  auditEvents,
  documentRequirements,
  personDocuments,
} from "@/lib/db/schema";
import {
  recordDeliveryAction,
  setRequirementsAction,
} from "@/lib/documents/actions";
import {
  activateDocumentRequirements,
  DocumentsAlreadyActiveError,
  getDocumentRequirementById,
  listDocumentRequirements,
  listPersonDocumentCard,
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
    active?: boolean;
  } = {},
) => ({
  name,
  required: extra.required ?? true,
  validityMonths: extra.validityMonths ?? null,
  sort: extra.sort ?? 0,
  active: extra.active ?? true,
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

  it("lib:documents/listPersonDocumentCard", async () => {
    const saved = await setRequirements(
      a.companyId,
      {
        positionId: a.position.id,
        requirements: [
          item("Credencial del puesto", { validityMonths: 12 }),
          item("Comprobante de domicilio", { sort: 1, required: false }),
          item("Pausado", { sort: 2, active: false }),
        ],
      },
      a.admin.id,
    );
    const requirement = saved?.find(
      (row) => row.name === "Credencial del puesto",
    );

    expect(requirement?.positionId).toBe(a.position.id);

    // Another company's person is not found. The expediente calls notFound().
    expect(
      await listPersonDocumentCard(b.companyId, a.person.id, "2026-10-28"),
    ).toBeNull();

    const card = await listPersonDocumentCard(
      a.companyId,
      a.person.id,
      "2026-10-28",
    );

    expect(card?.rows.map((row) => row.name)).toEqual([
      "Credencial del puesto",
      "Comprobante de domicilio",
    ]);
    expect(card?.state).toBe("missing");
    expect(card?.rows.map((row) => row.name)).not.toContain("Identificación");
    expect(card?.rows.map((row) => row.name)).not.toContain("Pausado");

    const otherCompany = await listPersonDocumentCard(
      b.companyId,
      b.person.id,
      "2026-10-28",
    );

    expect(otherCompany?.rows.map((row) => row.name) ?? []).not.toContain(
      "Credencial del puesto",
    );

    const withoutPosition = await listPersonDocumentCard(
      a.companyId,
      a.teammate.id,
      "2026-10-28",
    );

    expect(withoutPosition).toMatchObject({
      state: "empty",
      message: "Esta persona no tiene puesto.",
      rows: [],
    });

    const delivery = await recordDelivery(
      a.companyId,
      {
        personId: a.person.id,
        requirementId: requirement!.id,
        deliveredOn: "2026-01-15",
      },
      a.admin.id,
    );

    expect(delivery).toMatchObject({ expiresOn: "2027-01-15" });

    const events = await ownerDb
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.resourceId, delivery!.id));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      companyId: a.companyId,
      actorUserId: a.admin.id,
      resourceType: "person_document",
      action: "create",
    });
    expect(events[0]?.payload).toMatchObject({
      summary: "Documento registrado: Credencial del puesto",
    });

    const after = await listPersonDocumentCard(
      a.companyId,
      a.person.id,
      "2026-10-28",
    );

    expect(after?.rows[0]).toMatchObject({
      name: "Credencial del puesto",
      status: "valid",
      deliveredOn: "2026-01-15",
      expiresOn: "2027-01-15",
    });
    expect(after?.rows[1]?.status).toBe("missing");
    expect(after?.state).toBe("missing");
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

    expect(
      await setRequirementsAction(
        formData({
          payload: JSON.stringify({
            positionId: a.position.id,
            requirements: [item("Del puesto ajeno")],
          }),
        }),
      ),
    ).toEqual({ error: "No encontramos ese registro en esta empresa." });
    expect(
      (await requirementsOf(a.companyId)).some(
        (row) =>
          row.positionId === a.position.id && row.name === "Del puesto ajeno",
      ),
    ).toBe(false);
    expect(
      (await requirementsOf(b.companyId)).map((row) => row.name),
    ).not.toContain("Del puesto ajeno");
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

  it("computes a blank expiresOn and stores null only for noVence", async () => {
    const saved = await setRequirements(
      b.companyId,
      {
        positionId: b.position.id,
        requirements: [item("Gafete", { validityMonths: 12 })],
      },
      b.admin.id,
    );
    const requirement = saved?.[0];

    expect(requirement?.positionId).toBe(b.position.id);
    actAs(b.admin);

    expect(
      await recordDeliveryAction(
        formData({
          personId: b.person.id,
          requirementId: requirement!.id,
          deliveredOn: "2026-01-15",
          expiresOn: "",
        }),
      ),
    ).toEqual({ ok: true });
    expect(
      await recordDeliveryAction(
        formData({
          personId: b.person.id,
          requirementId: requirement!.id,
          deliveredOn: "2026-02-01",
          expiresOn: "2026-03-01",
          noVence: "on",
        }),
      ),
    ).toEqual({ ok: true });
    expect(
      await recordDeliveryAction(
        formData({
          personId: b.person.id,
          requirementId: requirement!.id,
          deliveredOn: "2026-03-01",
          expiresOn: "2026-06-01",
        }),
      ),
    ).toEqual({ ok: true });

    const rows = await deliveriesOf(b.companyId);
    const expiryOf = (deliveredOn: string) =>
      rows.find((row) => row.deliveredOn === deliveredOn)?.expiresOn;

    expect(expiryOf("2026-01-15")).toBe("2027-01-15");
    expect(expiryOf("2026-02-01")).toBeNull();
    expect(expiryOf("2026-03-01")).toBe("2026-06-01");
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

describe("simultaneous document activation", () => {
  it("returns a domain error instead of the raw unique violation", async () => {
    const fresh = await seedTenant("DD");
    const connectionString =
      process.env.TEST_OWNER_DATABASE_URL ?? process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error("No hay base de datos de prueba.");
    }

    const client = new Client({ connectionString });
    await client.connect();
    let pending: Promise<unknown> | undefined;

    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO document_requirements (company_id, name)
         VALUES ($1, $2)`,
        [fresh.companyId, onboardingChecklistLabels.ine],
      );

      let settled = false;
      pending = activateDocumentRequirements(fresh.companyId).finally(() => {
        settled = true;
      });

      const deadline = Date.now() + 5_000;
      let waiting = false;

      while (!settled && Date.now() < deadline) {
        const locks = await client.query(
          `SELECT 1
           FROM pg_locks
           WHERE NOT granted
             AND pid <> pg_backend_pid()`,
        );

        if ((locks.rowCount ?? 0) > 0) {
          waiting = true;
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 40));
      }

      if (!waiting) {
        throw new Error("La activación no esperó el índice único.");
      }

      await client.query("COMMIT");
      await expect(pending).rejects.toBeInstanceOf(DocumentsAlreadyActiveError);
      await expect(pending).rejects.toThrow(
        "El módulo de documentos ya está activo.",
      );
      await expect(pending).rejects.not.toSatisfy(isUniqueViolation);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
      await pending?.catch(() => undefined);
    }

    const live = await listDocumentRequirements(fresh.companyId, {
      positionId: null,
    });

    expect(live.map((row) => row.name)).toEqual([
      onboardingChecklistLabels.ine,
    ]);
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
