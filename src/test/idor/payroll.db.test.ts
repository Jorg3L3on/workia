/**
 * Nómina receipts (W2-03): pay periods, the CFDI import and its matching,
 * manual matching, publishing, downloads by HR and by the employee, and
 * discarding a draft. Company B cannot read or change company A's periods
 * or receipts, an employee only opens their own delivered receipts, and a
 * role without payroll_receipts:manage is denied. Titles are the surface ids
 * in docs/idor-matrix.md.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { GET as hrFileRoute } from "@/app/app/nomina/recibos/[id]/[archivo]/route";
import { POST as uploadRoute } from "@/app/api/nomina/periodos/[periodId]/recibos/route";
import { GET as employeeFileRoute } from "@/app/mi/recibos/[id]/[archivo]/route";
import { GET as localStorageRoute } from "@/app/api/storage/local/[...key]/route";
import {
  auditEvents,
  employeeAccounts,
  payrollEmployeeNumbers,
  payrollPeriods,
  payrollReceipts,
  people,
  personalDataAccessLog,
} from "@/lib/db/schema";
import {
  assignPayrollReceipt,
  countUnopenedEmployeeReceipts,
  createPayrollPeriod,
  discardPayrollPeriod,
  getPayrollPeriod,
  importPayrollReceipt,
  listEmployeeReceipts,
  listPayrollPeriods,
  listPayrollReceipts,
  matchReceiptPerson,
  openPayrollReceiptFile,
  publishPayrollPeriod,
  recordPayrollImport,
} from "@/lib/payroll";
import {
  assignPayrollReceiptAction,
  createPayrollPeriodAction,
  discardPayrollPeriodAction,
  finishPayrollImportAction,
  publishPayrollPeriodAction,
  searchPayrollPeopleAction,
} from "@/lib/payroll/actions";
import { PAYROLL_COPY } from "@/lib/payroll/schema";
import { sampleCurp } from "@/lib/people/identity";
import { localStorageDir } from "@/lib/storage/local";
import { COMPANY_FIELD, STALE_COMPANY_MESSAGE } from "@/lib/tenant/scope";
import { sampleCfdiNomina, samplePdf } from "@/test/cfdi";

import { idsIn, ownerDb, seedTenant, type Tenant } from "./fixtures";
import { actAs, NavigationThrow } from "./session-state";

const employee = vi.hoisted(() => ({
  current: null as null | {
    accountId: string;
    companyId: string;
    personId: string;
    sessionId: string;
  },
}));
const sent = vi.hoisted(() => [] as { to: string; subject: string }[]);

vi.mock("@/lib/employee-accounts/session", () => ({
  getEmployeeContext: async () => employee.current,
  requireEmployeeContext: async () => employee.current,
  requestOrigin: async () => "http://test",
}));

vi.mock("@/lib/email", () => ({
  sendEmail: async (message: { to: string; subject: string }) => {
    sent.push(message);
  },
  emailConfigured: () => true,
}));

let a: Tenant;
let b: Tenant;
let periodA: { id: string };
let periodB: { id: string };
/** a.person's receipt, matched by CURP. */
let receiptA: string;
/** An unmatched receipt of company A. */
let unmatchedA: string;

const encode = (text: string) => new TextEncoder().encode(text);

const formData = (values: Record<string, string>) => {
  const data = new FormData();

  for (const [key, value] of Object.entries(values)) {
    data.set(key, value);
  }

  return data;
};

const actAsEmployee = (tenant: Tenant, personId: string) => {
  employee.current = {
    accountId: randomUUID(),
    companyId: tenant.companyId,
    personId,
    sessionId: randomUUID(),
  };
};

const receiptsOf = (companyId: string) =>
  ownerDb
    .select()
    .from(payrollReceipts)
    .where(eq(payrollReceipts.companyId, companyId));

const accessOf = (companyId: string) =>
  ownerDb
    .select()
    .from(personalDataAccessLog)
    .where(eq(personalDataAccessLog.companyId, companyId));

const upload = (periodId: string, xml: string, pdf = true) => {
  const body = new FormData();

  body.set("xml", new Blob([xml], { type: "application/xml" }), "r.xml");
  if (pdf) {
    body.set(
      "pdf",
      new Blob([samplePdf()], { type: "application/pdf" }),
      "r.pdf",
    );
  }

  return uploadRoute(
    new Request(`http://test/api/nomina/periodos/${periodId}/recibos`, {
      method: "POST",
      body,
    }),
    { params: Promise.resolve({ periodId }) },
  );
};

const hrFile = (id: string, archivo = "pdf") =>
  hrFileRoute(new Request(`http://test/app/nomina/recibos/${id}/${archivo}`), {
    params: Promise.resolve({ id, archivo }),
  });

const employeeFile = (id: string, archivo = "pdf") =>
  employeeFileRoute(new Request(`http://test/mi/recibos/${id}/${archivo}`), {
    params: Promise.resolve({ id, archivo }),
  });

beforeAll(async () => {
  a = await seedTenant("RA");
  b = await seedTenant("RB");

  const createdA = await createPayrollPeriod(
    a.companyId,
    { label: "2026-10 Q2", periodStart: "2026-10-16", periodEnd: "2026-10-31" },
    a.admin.id,
  );
  const createdB = await createPayrollPeriod(
    b.companyId,
    { label: "2026-10 Q2", periodStart: "2026-10-16", periodEnd: "2026-10-31" },
    b.admin.id,
  );

  if (!createdA.ok || !createdB.ok) {
    throw new Error("No se pudieron crear los periodos.");
  }

  periodA = createdA.value;
  periodB = createdB.value;

  const matched = await importPayrollReceipt(
    a.companyId,
    periodA.id,
    {
      xml: encode(
        sampleCfdiNomina({
          curp: a.person.curp!,
          rfc: "XAXX010101000",
          numEmpleado: "A-001",
        }),
      ),
      pdf: samplePdf(),
    },
    a.admin.id,
  );
  const unmatched = await importPayrollReceipt(
    a.companyId,
    periodA.id,
    {
      xml: encode(
        sampleCfdiNomina({
          curp: sampleCurp(9_001),
          rfc: "ZZZZ800101ZZ9",
          numEmpleado: "A-777",
        }),
      ),
      pdf: samplePdf(),
    },
    a.admin.id,
  );

  if (matched?.status !== "matched" || unmatched?.status !== "unmatched") {
    throw new Error(
      "La importación de la empresa A no quedó como se esperaba.",
    );
  }

  receiptA = matched.receiptId;
  unmatchedA = unmatched.receiptId;

  // a.person has an active employee account with a verified email.
  await ownerDb.insert(employeeAccounts).values({
    companyId: a.companyId,
    personId: a.person.id,
    status: "active",
    email: `persona-${randomUUID().slice(0, 8)}@ra.test`,
    emailVerifiedAt: new Date(),
    activatedAt: new Date(),
  });
});

describe("periods stay inside the company", () => {
  it("lib:payroll/createPayrollPeriod", async () => {
    expect(
      await createPayrollPeriod(a.companyId, {
        label: "2026-10 Q2",
        periodStart: "2026-10-16",
        periodEnd: "2026-10-31",
      }),
    ).toEqual({ ok: false, error: PAYROLL_COPY.periodLabelTaken });

    const [row] = await ownerDb
      .select()
      .from(payrollPeriods)
      .where(eq(payrollPeriods.id, periodB.id));

    expect(row.companyId).toBe(b.companyId);
  });

  it("lib:payroll/listPayrollPeriods", async () => {
    expect(idsIn(await listPayrollPeriods(b.companyId))).not.toContain(
      periodA.id,
    );
    expect(await listPayrollPeriods(a.companyId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: periodA.id,
          receipts: 2,
          matched: 1,
          delivered: 0,
        }),
      ]),
    );
  });

  it("lib:payroll/getPayrollPeriod", async () => {
    expect(await getPayrollPeriod(b.companyId, periodA.id)).toBeNull();
    expect(await getPayrollPeriod(a.companyId, periodA.id)).toMatchObject({
      id: periodA.id,
      status: "draft",
    });
  });

  it("lib:payroll/listPayrollReceipts", async () => {
    expect(await listPayrollReceipts(b.companyId, periodA.id)).toEqual([]);

    const rows = await listPayrollReceipts(a.companyId, periodA.id);

    // Unmatched first, so HR sees them on top.
    expect(rows.map((row) => row.id)).toEqual([unmatchedA, receiptA]);
    expect(rows[1]).toMatchObject({ matchKind: "curp", hasPdf: true });
  });

  it("lib:payroll/recordPayrollImport", async () => {
    const summary = { matched: 1, unmatched: 1, duplicate: 0, invalid: 0 };

    expect(
      await recordPayrollImport(b.companyId, periodA.id, summary),
    ).toBeNull();

    const audit = await ownerDb
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.resourceId, periodA.id),
          eq(auditEvents.action, "import"),
        ),
      );

    expect(audit).toEqual([]);
    expect(
      await recordPayrollImport(a.companyId, periodA.id, summary, a.admin.id),
    ).toMatchObject({ id: periodA.id });
  });
});

describe("importing and matching", () => {
  it("lib:payroll/importPayrollReceipt", async () => {
    const before = await receiptsOf(a.companyId);

    // Company B cannot write into A's period.
    expect(
      await importPayrollReceipt(b.companyId, periodA.id, {
        xml: encode(sampleCfdiNomina({ curp: b.person.curp! })),
        pdf: null,
      }),
    ).toBeNull();
    expect(await receiptsOf(a.companyId)).toEqual(before);

    // B's person shares the CURP of nobody in A: inside B it matches B's own person.
    const inB = await importPayrollReceipt(b.companyId, periodB.id, {
      xml: encode(sampleCfdiNomina({ curp: b.person.curp! })),
      pdf: null,
    });
    const [rowB] = await ownerDb
      .select()
      .from(payrollReceipts)
      .where(
        eq(
          payrollReceipts.id,
          inB?.status === "matched" ? inB.receiptId : randomUUID(),
        ),
      );

    expect(rowB).toMatchObject({
      companyId: b.companyId,
      personId: b.person.id,
      pdfKey: null,
    });
  });

  it("matches a person without RFC by CURP, refuses what is not a CFDI and skips duplicates", async () => {
    const uuid = randomUUID();
    const xml = sampleCfdiNomina({
      uuid,
      curp: a.teammate.curp!,
      rfc: "XAXX010101000",
    });
    const first = await importPayrollReceipt(a.companyId, periodA.id, {
      xml: encode(xml),
      pdf: samplePdf(),
    });

    expect(a.teammate.rfc).toBeNull();
    expect(first).toMatchObject({ status: "matched", matchKind: "curp" });
    expect(
      await importPayrollReceipt(a.companyId, periodA.id, {
        xml: encode(xml),
        pdf: samplePdf(),
      }),
    ).toEqual({ status: "duplicate" });
    expect(
      await importPayrollReceipt(a.companyId, periodA.id, {
        xml: encode("<factura/>"),
        pdf: null,
      }),
    ).toMatchObject({ status: "invalid" });
    expect(
      await importPayrollReceipt(a.companyId, periodA.id, {
        xml: encode(sampleCfdiNomina()),
        pdf: encode("no soy un pdf"),
      }),
    ).toEqual({ status: "invalid", error: PAYROLL_COPY.pdfInvalid });

    // The file is in storage, not in the database.
    const [row] = await ownerDb
      .select()
      .from(payrollReceipts)
      .where(eq(payrollReceipts.cfdiUuid, uuid));

    expect(row.pdfKey).toBe(
      `${a.companyId}/receipts/${periodA.id}/${uuid}.pdf`,
    );
    expect(existsSync(path.join(localStorageDir(), row.pdfKey!))).toBe(true);
  });

  it("lib:payroll/matchReceiptPerson", async () => {
    const byCurp = {
      curp: a.person.curp!,
      numEmpleado: null,
      receptorRfc: "XAXX010101000",
    };

    expect(await matchReceiptPerson(b.companyId, byCurp)).not.toMatchObject({
      personId: a.person.id,
    });
    expect(await matchReceiptPerson(a.companyId, byCurp)).toEqual({
      personId: a.person.id,
      matchKind: "curp",
    });
    // Learned from the CURP match above: A-001 is a.person in A, nobody in B.
    const byNumber = {
      curp: null,
      numEmpleado: "A-001",
      receptorRfc: "XAXX010101000",
    };

    expect(await matchReceiptPerson(a.companyId, byNumber)).toEqual({
      personId: a.person.id,
      matchKind: "num_empleado",
    });
    expect(await matchReceiptPerson(b.companyId, byNumber)).toBeNull();
    expect(
      await matchReceiptPerson(a.companyId, {
        curp: null,
        numEmpleado: null,
        receptorRfc: a.person.rfc!,
      }),
    ).toEqual({ personId: a.person.id, matchKind: "rfc" });
    expect(
      await matchReceiptPerson(b.companyId, {
        curp: null,
        numEmpleado: null,
        receptorRfc: a.person.rfc!,
      }),
    ).toBeNull();
  });

  it("imports a period of 500 receipts; every one is matched or listed as unmatched", async () => {
    const created = await createPayrollPeriod(a.companyId, {
      label: "Carga de 500",
      periodStart: "2026-11-01",
      periodEnd: "2026-11-15",
    });

    if (!created.ok) throw new Error(created.error);

    const curps = Array.from({ length: 495 }, (_, index) =>
      sampleCurp(20_000 + index),
    );

    await ownerDb.insert(people).values(
      curps.map((curp, index) => ({
        companyId: a.companyId,
        nombres: `Carga ${index}`,
        apellidoPaterno: "Quincena",
        curp,
      })),
    );

    const xmls = [
      ...curps.map((curp) =>
        sampleCfdiNomina({ curp, rfc: "XAXX010101000", numEmpleado: null }),
      ),
      ...Array.from({ length: 5 }, (_, index) =>
        sampleCfdiNomina({
          curp: sampleCurp(30_000 + index),
          rfc: "XAXX010101000",
          numEmpleado: null,
        }),
      ),
    ];
    const outcomes: string[] = [];
    const queue = [...xmls];

    await Promise.all(
      Array.from({ length: 8 }, async () => {
        for (let xml = queue.shift(); xml; xml = queue.shift()) {
          const outcome = await importPayrollReceipt(
            a.companyId,
            created.value.id,
            {
              xml: encode(xml),
              pdf: samplePdf(),
            },
          );
          outcomes.push(outcome?.status ?? "missing");
        }
      }),
    );

    expect(outcomes.filter((status) => status === "matched")).toHaveLength(495);
    expect(outcomes.filter((status) => status === "unmatched")).toHaveLength(5);

    const period = await getPayrollPeriod(a.companyId, created.value.id);

    expect(period).toMatchObject({ receipts: 500, matched: 495 });
    expect(
      (await listPayrollReceipts(a.companyId, created.value.id)).filter(
        (row) => !row.personId,
      ),
    ).toHaveLength(5);
  }, 180_000);
});

describe("matching by hand", () => {
  it("lib:payroll/assignPayrollReceipt", async () => {
    expect(
      await assignPayrollReceipt(b.companyId, unmatchedA, b.person.id),
    ).toEqual({ ok: false, error: PAYROLL_COPY.receiptNotFound });
    expect(
      await assignPayrollReceipt(a.companyId, unmatchedA, b.person.id),
    ).toEqual({ ok: false, error: PAYROLL_COPY.personNotFound });

    const [unchanged] = await ownerDb
      .select()
      .from(payrollReceipts)
      .where(eq(payrollReceipts.id, unmatchedA));

    expect(unchanged.personId).toBeNull();
  });
});

describe("publishing", () => {
  it("lib:payroll/publishPayrollPeriod", async () => {
    expect(
      await publishPayrollPeriod(b.companyId, periodA.id, b.admin.id, {
        origin: "http://test",
      }),
    ).toEqual({ ok: false, error: PAYROLL_COPY.periodNotFound });
    expect((await getPayrollPeriod(a.companyId, periodA.id))?.status).toBe(
      "draft",
    );

    sent.length = 0;
    const result = await publishPayrollPeriod(
      a.companyId,
      periodA.id,
      a.admin.id,
      {
        origin: "http://test",
      },
    );

    expect(result).toEqual({ ok: true, value: { delivered: 2, emailed: 1 } });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain("2026-10 Q2");
    expect(
      await publishPayrollPeriod(a.companyId, periodA.id, a.admin.id),
    ).toEqual({ ok: false, error: PAYROLL_COPY.periodAlreadyPublished });
  });

  it("delivers a receipt matched by hand after publishing, and remembers its number", async () => {
    expect(
      await assignPayrollReceipt(
        a.companyId,
        unmatchedA,
        a.teammate.id,
        a.admin.id,
      ),
    ).toEqual({ ok: true, value: { delivered: true } });

    const [number] = await ownerDb
      .select()
      .from(payrollEmployeeNumbers)
      .where(
        and(
          eq(payrollEmployeeNumbers.companyId, a.companyId),
          eq(payrollEmployeeNumbers.numEmpleado, "A-777"),
        ),
      );

    expect(number.personId).toBe(a.teammate.id);
    expect(
      await assignPayrollReceipt(a.companyId, unmatchedA, a.person.id),
    ).toEqual({ ok: false, error: PAYROLL_COPY.receiptAlreadyMatched });
  });
});

describe("downloads", () => {
  it("lib:payroll/openPayrollReceiptFile", async () => {
    const before = await accessOf(a.companyId);

    expect(
      await openPayrollReceiptFile(b.companyId, receiptA, "pdf", {
        kind: "hr_user",
        userId: b.admin.id,
      }),
    ).toBeNull();
    // The teammate cannot open a.person's receipt.
    expect(
      await openPayrollReceiptFile(a.companyId, receiptA, "pdf", {
        kind: "employee",
        personId: a.teammate.id,
      }),
    ).toBeNull();
    expect(await accessOf(a.companyId)).toEqual(before);

    // HR opening it is logged but is not the employee opening it.
    expect(
      await openPayrollReceiptFile(a.companyId, receiptA, "xml", {
        kind: "hr_user",
        userId: a.admin.id,
      }),
    ).toMatchObject({ url: expect.stringContaining("/api/storage/local/") });

    const [afterHr] = await ownerDb
      .select()
      .from(payrollReceipts)
      .where(eq(payrollReceipts.id, receiptA));

    expect(afterHr.openedAt).toBeNull();
    expect(await accessOf(a.companyId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          personId: a.person.id,
          resource: "payroll_receipt",
          resourceId: receiptA,
          actorKind: "hr_user",
          actorUserId: a.admin.id,
        }),
      ]),
    );
  });

  it("route:GET /mi/recibos/[id]/[archivo]", async () => {
    actAsEmployee(b, b.person.id);
    expect((await employeeFile(receiptA)).status).toBe(404);

    actAsEmployee(a, a.teammate.id);
    expect((await employeeFile(receiptA)).status).toBe(404);

    employee.current = null;
    expect((await employeeFile(receiptA)).headers.get("location")).toBe(
      "http://test/mi/entrar",
    );

    actAsEmployee(a, a.person.id);
    expect(await countUnopenedEmployeeReceipts(employee.current!)).toBe(1);

    const response = await employeeFile(receiptA);

    expect(response.status).toBe(303);

    // The signed link serves the PDF from storage.
    const location = new URL(response.headers.get("location")!);
    const file = await localStorageRoute(new Request(location), {
      params: Promise.resolve({
        key: location.pathname.replace("/api/storage/local/", "").split("/"),
      }),
    });

    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("application/pdf");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(samplePdf());

    const [opened] = await ownerDb
      .select()
      .from(payrollReceipts)
      .where(eq(payrollReceipts.id, receiptA));

    expect(opened.openedAt).not.toBeNull();
    expect(await countUnopenedEmployeeReceipts(employee.current!)).toBe(0);
    expect(
      (await listEmployeeReceipts(employee.current!)).map((row) => row.id),
    ).toEqual([receiptA]);
    expect(await accessOf(a.companyId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: receiptA,
          actorKind: "employee",
          actorUserId: null,
        }),
      ]),
    );
    expect(await listPayrollPeriods(a.companyId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: periodA.id, delivered: 3, opened: 1 }),
      ]),
    );
  });

  it("does not hand an employee a receipt before its period is published", async () => {
    const draft = await createPayrollPeriod(a.companyId, {
      label: "Borrador",
      periodStart: "2026-12-01",
      periodEnd: "2026-12-15",
    });

    if (!draft.ok) throw new Error(draft.error);

    const outcome = await importPayrollReceipt(a.companyId, draft.value.id, {
      xml: encode(sampleCfdiNomina({ curp: a.person.curp! })),
      pdf: samplePdf(),
    });

    expect(outcome).toMatchObject({ status: "matched" });
    actAsEmployee(a, a.person.id);
    expect(
      (
        await employeeFile(
          outcome?.status === "matched" ? outcome.receiptId : "",
        )
      ).status,
    ).toBe(404);
    expect(
      (await listEmployeeReceipts(employee.current!)).map((row) => row.id),
    ).not.toContain(outcome?.status === "matched" ? outcome.receiptId : "");
  });

  it("route:GET /app/nomina/recibos/[id]/[archivo]", async () => {
    actAs(b.admin);
    expect((await hrFile(receiptA)).status).toBe(404);
    actAs(a.admin);
    expect((await hrFile(receiptA)).status).toBe(303);
    expect((await hrFile(receiptA, "zip")).status).toBe(404);
  });

  it("rbac:route:GET /app/nomina/recibos/[id]/[archivo]", async () => {
    actAs(a.viewer);
    expect((await hrFile(receiptA)).status).toBe(403);
    actAs(a.editor);
    expect((await hrFile(receiptA)).status).toBe(403);
  });
});

describe("upload route", () => {
  it("route:POST /api/nomina/periodos/[periodId]/recibos", async () => {
    const before = await receiptsOf(a.companyId);

    actAs(b.admin);
    expect((await upload(periodA.id, sampleCfdiNomina())).status).toBe(404);
    expect(await receiptsOf(a.companyId)).toEqual(before);

    actAs(a.admin);
    const ok = await upload(
      periodA.id,
      sampleCfdiNomina({ curp: a.person.curp! }),
    );

    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({
      status: "matched",
      matchKind: "curp",
    });

    const bad = await upload(periodA.id, "<factura/>", false);

    expect(bad.status).toBe(422);
  });

  it("rbac:route:POST /api/nomina/periodos/[periodId]/recibos", async () => {
    const before = await receiptsOf(a.companyId);

    actAs(a.viewer);
    expect((await upload(periodA.id, sampleCfdiNomina())).status).toBe(403);
    actAs(a.editor);
    expect((await upload(periodA.id, sampleCfdiNomina())).status).toBe(403);
    expect(await receiptsOf(a.companyId)).toEqual(before);
  });
});

describe("discarding a draft", () => {
  it("lib:payroll/discardPayrollPeriod", async () => {
    expect(await discardPayrollPeriod(b.companyId, periodA.id)).toEqual({
      ok: false,
      error: PAYROLL_COPY.periodNotFound,
    });
    expect(await discardPayrollPeriod(a.companyId, periodA.id)).toEqual({
      ok: false,
      error: PAYROLL_COPY.periodNotDraft,
    });

    const draft = await createPayrollPeriod(a.companyId, {
      label: "Zip equivocado",
      periodStart: "2026-12-16",
      periodEnd: "2026-12-31",
    });

    if (!draft.ok) throw new Error(draft.error);

    await importPayrollReceipt(a.companyId, draft.value.id, {
      xml: encode(sampleCfdiNomina()),
      pdf: samplePdf(),
    });

    const [row] = await ownerDb
      .select()
      .from(payrollReceipts)
      .where(eq(payrollReceipts.periodId, draft.value.id));

    expect(await discardPayrollPeriod(a.companyId, draft.value.id)).toEqual({
      ok: true,
      value: { receipts: 1 },
    });
    expect(existsSync(path.join(localStorageDir(), row.pdfKey!))).toBe(false);
    expect(await getPayrollPeriod(a.companyId, draft.value.id)).toBeNull();
  });
});

describe("actions stay inside the company", () => {
  it("action:payroll/createPayrollPeriodAction", async () => {
    actAs(b.admin);
    expect(
      await createPayrollPeriodAction(
        {},
        formData({
          label: "Intruso",
          periodStart: "2026-10-01",
          periodEnd: "2026-10-15",
          [COMPANY_FIELD]: a.companyId,
        }),
      ),
    ).toEqual({ error: STALE_COMPANY_MESSAGE });

    const created = await createPayrollPeriodAction(
      {},
      formData({
        label: "Propio de B",
        periodStart: "2026-10-01",
        periodEnd: "2026-10-15",
      }),
    );

    expect(created).toMatchObject({ ok: true });
    expect(await getPayrollPeriod(a.companyId, created.periodId!)).toBeNull();
    expect(
      await getPayrollPeriod(b.companyId, created.periodId!),
    ).not.toBeNull();
  });

  it("rbac:action:payroll/createPayrollPeriodAction", async () => {
    for (const user of [a.viewer, a.editor]) {
      actAs(user);
      expect(
        await createPayrollPeriodAction(
          {},
          formData({
            label: "X",
            periodStart: "2026-10-01",
            periodEnd: "2026-10-15",
          }),
        ),
      ).toEqual({ error: PAYROLL_COPY.denied });
    }
  });

  it("action:payroll/finishPayrollImportAction", async () => {
    actAs(b.admin);
    expect(
      await finishPayrollImportAction(
        {},
        formData({ periodId: periodA.id, matched: "1" }),
      ),
    ).toEqual({ error: PAYROLL_COPY.periodNotFound });
  });

  it("rbac:action:payroll/finishPayrollImportAction", async () => {
    actAs(a.viewer);
    expect(
      await finishPayrollImportAction({}, formData({ periodId: periodA.id })),
    ).toEqual({ error: PAYROLL_COPY.denied });
  });

  it("action:payroll/assignPayrollReceiptAction", async () => {
    actAs(b.admin);
    expect(
      await assignPayrollReceiptAction(
        {},
        formData({ receiptId: receiptA, personId: b.person.id }),
      ),
    ).toEqual({ error: PAYROLL_COPY.receiptNotFound });
  });

  it("rbac:action:payroll/assignPayrollReceiptAction", async () => {
    actAs(a.viewer);
    expect(
      await assignPayrollReceiptAction(
        {},
        formData({ receiptId: receiptA, personId: a.person.id }),
      ),
    ).toEqual({ error: PAYROLL_COPY.denied });
  });

  it("action:payroll/publishPayrollPeriodAction", async () => {
    const draft = await createPayrollPeriod(a.companyId, {
      label: "Por publicar",
      periodStart: "2027-01-01",
      periodEnd: "2027-01-15",
    });

    if (!draft.ok) throw new Error(draft.error);

    actAs(b.admin);
    expect(
      await publishPayrollPeriodAction(
        {},
        formData({ periodId: draft.value.id }),
      ),
    ).toEqual({ error: PAYROLL_COPY.periodNotFound });
    expect((await getPayrollPeriod(a.companyId, draft.value.id))?.status).toBe(
      "draft",
    );

    actAs(a.admin);
    expect(
      await publishPayrollPeriodAction(
        {},
        formData({ periodId: draft.value.id }),
      ),
    ).toMatchObject({ ok: true });
  });

  it("rbac:action:payroll/publishPayrollPeriodAction", async () => {
    actAs(a.viewer);
    expect(
      await publishPayrollPeriodAction({}, formData({ periodId: periodA.id })),
    ).toEqual({ error: PAYROLL_COPY.denied });
  });

  it("action:payroll/discardPayrollPeriodAction", async () => {
    const draft = await createPayrollPeriod(a.companyId, {
      label: "Por descartar",
      periodStart: "2027-01-16",
      periodEnd: "2027-01-31",
    });

    if (!draft.ok) throw new Error(draft.error);

    actAs(b.admin);
    expect(
      await discardPayrollPeriodAction(
        {},
        formData({ periodId: draft.value.id }),
      ),
    ).toEqual({ error: PAYROLL_COPY.periodNotFound });
    expect(await getPayrollPeriod(a.companyId, draft.value.id)).not.toBeNull();

    actAs(a.admin);
    await expect(
      discardPayrollPeriodAction({}, formData({ periodId: draft.value.id })),
    ).rejects.toEqual(new NavigationThrow("redirect", "/app/nomina"));
    expect(await getPayrollPeriod(a.companyId, draft.value.id)).toBeNull();
  });

  it("rbac:action:payroll/discardPayrollPeriodAction", async () => {
    actAs(a.viewer);
    expect(
      await discardPayrollPeriodAction({}, formData({ periodId: periodA.id })),
    ).toEqual({ error: PAYROLL_COPY.denied });
  });

  it("action:payroll/searchPayrollPeopleAction", async () => {
    actAs(b.admin);
    expect(
      (await searchPayrollPeopleAction("Persona RA")).map((row) => row.id),
    ).not.toContain(a.person.id);
    actAs(a.admin);
    expect(
      (await searchPayrollPeopleAction("Persona RA")).map((row) => row.id),
    ).toContain(a.person.id);
  });

  it("rbac:action:payroll/searchPayrollPeopleAction", async () => {
    actAs(a.viewer);
    expect(await searchPayrollPeopleAction("Persona")).toEqual([]);
  });
});
