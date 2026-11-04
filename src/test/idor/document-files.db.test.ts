/**
 * Document files and review (Workia 2.0 W2-04) on a real database and the
 * local storage driver. An employee uploads only for their own person and a
 * requirement of their puesto, and opens only their own files; HR of company
 * B cannot list, open or review company A's uploads; a role without
 * documents:manage cannot review. Titles are the surface ids of
 * docs/idor-matrix.md.
 */
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

const employee = vi.hoisted(() => ({
  current: null as null | {
    accountId: string;
    companyId: string;
    personId: string;
    sessionId: string;
  },
}));

vi.mock("@/lib/employee-accounts/session", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/employee-accounts/session")>();
  const { NavigationThrow } = await import("@/test/idor/session-state");

  return {
    ...original,
    getEmployeeContext: async () => employee.current,
    requireEmployeeContext: async () => {
      if (!employee.current)
        throw new NavigationThrow("redirect", "/mi/entrar");
      return employee.current;
    },
  };
});

import { POST as uploadRoute } from "@/app/api/mi/documentos/route";
import { GET as hrFileRoute } from "@/app/app/documentos/revision/[documentId]/archivo/route";
import { GET as employeeFileRoute } from "@/app/mi/documentos/[documentId]/archivo/route";
import {
  auditEvents,
  employeeAccounts,
  notifications,
  personalDataAccessLog,
  personDocuments,
  personEvents,
  privacyNoticeAcceptances,
} from "@/lib/db/schema";
import { setRequirements, listPersonDocumentCard } from "@/lib/documents";
import { reviewDocumentAction } from "@/lib/documents/actions";
import {
  documentFileUrlForHr,
  listDocumentReviewQueue,
  reviewDocument,
  uploadEmployeeDocument,
} from "@/lib/documents/files";
import { DOCUMENT_FILES_COPY } from "@/lib/documents/files-schema";
import { publishPrivacyNotice, recordPrivacyAcceptance } from "@/lib/privacy";
import { acceptPrivacyNoticeFromAppAction } from "@/lib/privacy/employee-actions";
import { PRIVACY_COPY } from "@/lib/privacy/schema";
import { readLocalObject } from "@/lib/storage/local";
import { STALE_COMPANY_MESSAGE } from "@/lib/tenant/scope";

import { idsIn, ownerDb, seedTenant, type Tenant } from "./fixtures";
import { actAs, NavigationThrow } from "./session-state";

let a: Tenant;
let b: Tenant;
let requirementA: string;
let requirementB: string;
let noticeA: string;
let noticeB: string;
const ctx = {} as Record<"a" | "b", NonNullable<typeof employee.current>>;

const today = "2026-11-04";
const jpeg = () =>
  new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(64).fill(7)]);

const formData = (values: Record<string, string | Blob>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

const uploadRequest = (requirementId: string) =>
  new Request("https://workia.test/api/mi/documentos", {
    method: "POST",
    headers: { origin: "https://workia.test" },
    body: formData({
      requirementId,
      file: new Blob([jpeg()], { type: "image/jpeg" }),
    }),
  });

const routeContext = (documentId: string) => ({
  params: Promise.resolve({ documentId }),
});

const documentsOf = (companyId: string) =>
  ownerDb
    .select()
    .from(personDocuments)
    .where(eq(personDocuments.companyId, companyId));

const accessRows = (companyId: string, documentId: string) =>
  ownerDb
    .select()
    .from(personalDataAccessLog)
    .where(
      and(
        eq(personalDataAccessLog.companyId, companyId),
        eq(personalDataAccessLog.resourceId, documentId),
      ),
    );

/** Uploads a fresh file for A's person and returns its row id. */
const uploadForA = async () => {
  const result = await uploadEmployeeDocument(ctx.a, {
    requirementId: requirementA,
    file: { bytes: jpeg() },
    today,
  });
  if (!result.ok) throw new Error(result.error);
  return result.value.id;
};

const account = async (tenant: Tenant) => {
  const [row] = await ownerDb
    .insert(employeeAccounts)
    .values({
      companyId: tenant.companyId,
      personId: tenant.person.id,
      status: "active",
      email: `persona.${tenant.label.toLowerCase()}@empleo.test`,
      activatedAt: new Date(),
    })
    .returning();
  return {
    accountId: row!.id,
    companyId: tenant.companyId,
    personId: tenant.person.id,
    sessionId: "test",
  };
};

const requirementFor = async (tenant: Tenant, name: string) => {
  const saved = await setRequirements(
    tenant.companyId,
    {
      positionId: tenant.position.id,
      requirements: [
        { name, required: true, validityMonths: 12, sort: 0, active: true },
      ],
    },
    tenant.admin.id,
  );
  return saved![0]!.id;
};

const notice = async (tenant: Tenant) => {
  const result = await publishPrivacyNotice(
    tenant.companyId,
    { body: `Aviso de privacidad de ${tenant.label}.` },
    tenant.admin.id,
  );
  if (!result.ok) throw new Error(result.error);
  return result.value.id;
};

beforeAll(async () => {
  a = await seedTenant("FA");
  b = await seedTenant("FB");
  requirementA = await requirementFor(a, "INE");
  requirementB = await requirementFor(b, "INE");
  noticeA = await notice(a);
  noticeB = await notice(b);
  ctx.a = await account(a);
  ctx.b = await account(b);
  await recordPrivacyAcceptance(a.companyId, {
    personId: a.person.id,
    noticeId: noticeA,
    channel: "employee_app",
  });
});

describe("an employee uploads and opens only their own documents", () => {
  it("route:POST /api/mi/documentos", async () => {
    employee.current = null;
    expect((await uploadRoute(uploadRequest(requirementA))).status).toBe(401);

    // B's person has not accepted B's notice yet.
    employee.current = ctx.b;
    const blocked = await uploadRoute(uploadRequest(requirementB));
    expect(blocked.status).toBe(400);
    expect(await blocked.json()).toEqual({
      error: DOCUMENT_FILES_COPY.noticePending,
    });

    await recordPrivacyAcceptance(b.companyId, {
      personId: b.person.id,
      noticeId: noticeB,
      channel: "employee_app",
    });

    // A's requirement is not B's person's.
    const before = (await documentsOf(a.companyId)).length;
    const foreign = await uploadRoute(uploadRequest(requirementA));
    expect(foreign.status).toBe(400);
    expect(await foreign.json()).toEqual({
      error: DOCUMENT_FILES_COPY.notRequired,
    });
    expect((await documentsOf(a.companyId)).length).toBe(before);

    // Another site cannot post with the employee's cookie.
    const crossSite = await uploadRoute(
      new Request("https://workia.test/api/mi/documentos", {
        method: "POST",
        headers: { origin: "https://evil.test" },
        body: formData({ requirementId: requirementB }),
      }),
    );
    expect(crossSite.status).toBe(403);

    const own = await uploadRoute(uploadRequest(requirementB));
    expect(own.status).toBe(201);
    const [row] = await documentsOf(b.companyId);
    expect(row).toMatchObject({
      personId: b.person.id,
      requirementId: requirementB,
      status: "uploaded",
      fileContentType: "image/jpeg",
      uploadedByAccountId: ctx.b.accountId,
    });
    expect(row!.fileKey).toMatch(
      new RegExp(`^${b.companyId}/documents/${b.person.id}/${row!.id}\\.jpg$`),
    );
    expect(await readLocalObject(row!.fileKey!)).not.toBeNull();

    // One pending upload per requirement.
    const again = await uploadRoute(uploadRequest(requirementB));
    expect(await again.json()).toEqual({ error: DOCUMENT_FILES_COPY.pending });

    const [audit] = await ownerDb
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.resourceId, row!.id));
    expect(audit).toMatchObject({
      companyId: b.companyId,
      actorEmployeeAccountId: ctx.b.accountId,
      source: "employee",
      action: "create",
    });
  });

  it("refuses a file that is not an image or a PDF", async () => {
    const result = await uploadEmployeeDocument(ctx.a, {
      requirementId: requirementA,
      file: { bytes: new TextEncoder().encode("<html><script>") },
      today,
    });
    expect(result).toEqual({ ok: false, error: DOCUMENT_FILES_COPY.badType });
  });

  it("route:GET /mi/documentos/[documentId]/archivo", async () => {
    const documentId = await uploadForA();

    employee.current = ctx.b;
    expect(
      (
        await employeeFileRoute(
          new Request(
            `https://workia.test/mi/documentos/${documentId}/archivo`,
          ),
          routeContext(documentId),
        )
      ).status,
    ).toBe(404);
    expect(await accessRows(a.companyId, documentId)).toEqual([]);

    employee.current = ctx.a;
    const response = await employeeFileRoute(
      new Request(`https://workia.test/mi/documentos/${documentId}/archivo`),
      routeContext(documentId),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toMatch(
      /^https:\/\/workia\.test\/api\/storage\/local\//,
    );
    expect(await accessRows(a.companyId, documentId)).toMatchObject([
      {
        personId: a.person.id,
        resource: "document_file",
        actorKind: "employee",
      },
    ]);

    employee.current = null;
    await expect(
      employeeFileRoute(
        new Request(`https://workia.test/mi/documentos/${documentId}/archivo`),
        routeContext(documentId),
      ),
    ).rejects.toBeInstanceOf(NavigationThrow);

    await reviewDocument(
      a.companyId,
      { decision: "reject", documentId, reason: "illegible" },
      a.admin.id,
    );
  });

  it("action:privacy/acceptPrivacyNoticeFromAppAction", async () => {
    // B's employee cannot accept A's notice, and nothing lands in A.
    employee.current = ctx.b;
    const before = await ownerDb
      .select()
      .from(privacyNoticeAcceptances)
      .where(eq(privacyNoticeAcceptances.companyId, a.companyId));
    expect(
      await acceptPrivacyNoticeFromAppAction(
        undefined,
        formData({ noticeId: noticeA }),
      ),
    ).toEqual({ error: PRIVACY_COPY.noticeNotCurrent });
    expect(
      await ownerDb
        .select()
        .from(privacyNoticeAcceptances)
        .where(eq(privacyNoticeAcceptances.companyId, a.companyId)),
    ).toHaveLength(before.length);

    // B's own notice, already accepted, keeps the first acceptance.
    expect(
      await acceptPrivacyNoticeFromAppAction(
        undefined,
        formData({ noticeId: noticeB }),
      ),
    ).toEqual({});
  });
});

describe("HR reviews only its company's uploads", () => {
  it("lib:documents/files/listDocumentReviewQueue", async () => {
    const documentId = await uploadForA();

    expect(
      idsIn((await listDocumentReviewQueue(b.companyId)).rows),
    ).not.toContain(documentId);
    const queue = await listDocumentReviewQueue(a.companyId);
    expect(queue.rows.map((row) => row.id)).toContain(documentId);
    expect(queue.total).toBe(queue.rows.length);

    await reviewDocument(
      a.companyId,
      { decision: "reject", documentId, reason: "illegible" },
      a.admin.id,
    );
    expect(
      (await listDocumentReviewQueue(a.companyId)).rows.map((row) => row.id),
    ).not.toContain(documentId);
  });

  it("lib:documents/files/documentFileUrlForHr", async () => {
    const documentId = await uploadForA();

    expect(
      await documentFileUrlForHr(b.companyId, documentId, b.admin.id),
    ).toBeNull();
    expect(await accessRows(a.companyId, documentId)).toEqual([]);
    expect(
      await documentFileUrlForHr(a.companyId, documentId, a.admin.id),
    ).toMatch(/^\/api\/storage\/local\//);
    expect(await accessRows(a.companyId, documentId)).toMatchObject([
      { actorKind: "hr_user", actorUserId: a.admin.id },
    ]);

    await reviewDocument(
      a.companyId,
      { decision: "reject", documentId, reason: "wrong_document" },
      a.admin.id,
    );
  });

  it("route:GET /app/documentos/revision/[documentId]/archivo", async () => {
    const documentId = await uploadForA();
    const request = new Request(
      `https://workia.test/app/documentos/revision/${documentId}/archivo`,
    );

    actAs(b.admin);
    expect((await hrFileRoute(request, routeContext(documentId))).status).toBe(
      404,
    );
    actAs(a.admin);
    expect((await hrFileRoute(request, routeContext(documentId))).status).toBe(
      303,
    );
    actAs(null);
    expect((await hrFileRoute(request, routeContext(documentId))).status).toBe(
      403,
    );

    await reviewDocument(
      a.companyId,
      { decision: "reject", documentId, reason: "illegible" },
      a.admin.id,
    );
  });

  it("lib:documents/files/reviewDocument", async () => {
    const documentId = await uploadForA();

    expect(
      await reviewDocument(
        b.companyId,
        { decision: "accept", documentId },
        b.admin.id,
      ),
    ).toBeNull();
    expect(
      (await documentsOf(a.companyId)).find((row) => row.id === documentId)
        ?.status,
    ).toBe("uploaded");

    const accepted = await reviewDocument(
      a.companyId,
      { decision: "accept", documentId },
      a.admin.id,
    );
    expect(accepted).toMatchObject({
      updated: {
        status: "accepted",
        deliveredOn: today,
        expiresOn: "2027-11-04",
        reviewedBy: a.admin.id,
      },
    });
    // Reviewed once only.
    expect(
      await reviewDocument(
        a.companyId,
        { decision: "reject", documentId, reason: "illegible" },
        a.admin.id,
      ),
    ).toBeNull();

    const card = await listPersonDocumentCard(a.companyId, a.person.id, today);
    expect(card?.rows[0]).toMatchObject({
      status: "valid",
      deliveredOn: today,
      expiresOn: "2027-11-04",
      fileDocumentId: documentId,
    });
    expect(card?.rows[0]?.review).toBeUndefined();

    // A rejection deletes the file and keeps the reason.
    const rejectedId = await uploadForA();
    const [pending] = (await documentsOf(a.companyId)).filter(
      (row) => row.id === rejectedId,
    );
    await reviewDocument(
      a.companyId,
      { decision: "reject", documentId: rejectedId, reason: "incomplete" },
      a.admin.id,
    );
    const [rejected] = (await documentsOf(a.companyId)).filter(
      (row) => row.id === rejectedId,
    );
    expect(rejected).toMatchObject({
      status: "rejected",
      rejectionReason: "incomplete",
      fileKey: null,
    });
    expect(await readLocalObject(pending!.fileKey!)).toBeNull();
    const afterReject = await listPersonDocumentCard(
      a.companyId,
      a.person.id,
      today,
    );
    expect(afterReject?.rows[0]).toMatchObject({
      status: "valid",
      review: {
        id: rejectedId,
        status: "rejected",
        rejectionReason: "incomplete",
      },
    });

    // Upload, acceptance and rejection are on the timeline (W2-13), and
    // the person is told about the rejection (W2-08).
    const events = await ownerDb
      .select({ key: personEvents.dedupeKey, payload: personEvents.payload })
      .from(personEvents)
      .where(eq(personEvents.personId, a.person.id));
    const keys = events.map((event) => event.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        `document:person_document:${documentId}:uploaded`,
        `document:person_document:${documentId}:accepted`,
        `document:person_document:${rejectedId}:uploaded`,
        `document:person_document:${rejectedId}:rejected`,
      ]),
    );
    const [notice] = await ownerDb
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientPersonId, a.person.id),
          eq(notifications.template, "document_rejected"),
        ),
      );
    expect(notice).toMatchObject({
      companyId: a.companyId,
      url: "/mi/documentos",
      title: "RH rechazó tu documento: INE",
    });
  });

  it("action:documents/reviewDocumentAction", async () => {
    const documentId = await uploadForA();

    actAs(b.admin);
    expect(
      await reviewDocumentAction(
        formData({ companyId: a.companyId, decision: "accept", documentId }),
      ),
    ).toEqual({ error: STALE_COMPANY_MESSAGE });
    expect(
      await reviewDocumentAction(formData({ decision: "accept", documentId })),
    ).toEqual({ error: DOCUMENT_FILES_COPY.notFound });

    actAs(a.admin);
    expect(
      await reviewDocumentAction(
        formData({ decision: "reject", documentId, reason: "otra cosa" }),
      ),
    ).toEqual({ error: "Elige el motivo del rechazo." });
    expect(
      await reviewDocumentAction(
        formData({ decision: "accept", documentId, noVence: "on" }),
      ),
    ).toEqual({ ok: true });
    expect(
      (await documentsOf(a.companyId)).find((row) => row.id === documentId),
    ).toMatchObject({ status: "accepted", expiresOn: null });
  });

  it("rbac:action:documents/reviewDocumentAction", async () => {
    const documentId = await uploadForA();

    actAs(a.viewer);
    expect(
      await reviewDocumentAction(formData({ decision: "accept", documentId })),
    ).toEqual({ error: "No tienes permiso para gestionar documentos." });
    expect(
      (await documentsOf(a.companyId)).find((row) => row.id === documentId)
        ?.status,
    ).toBe("uploaded");

    await reviewDocument(
      a.companyId,
      { decision: "reject", documentId, reason: "illegible" },
      a.admin.id,
    );
  });
});
