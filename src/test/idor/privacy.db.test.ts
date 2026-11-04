/**
 * Privacy notice, acceptances, the personal data access log, ARCO requests,
 * the ARCO export and the retention job (W2-09). Company B cannot read or
 * change company A's rows, and a role without privacy:manage is denied.
 * Titles are the surface ids in docs/idor-matrix.md.
 */
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { GET as exportRoute } from "@/app/app/privacidad/arco/[id]/exportar/route";
import {
  arcoRequests,
  auditEvents,
  personalDataAccessLog,
  privacyNoticeAcceptances,
  privacyNotices,
} from "@/lib/db/schema";
import {
  buildPersonDataExport,
  createArcoRequest,
  getArcoRequest,
  getCurrentPrivacyNotice,
  listArcoRequests,
  listPersonalDataAccess,
  listPrivacyNotices,
  pendingPrivacyNotice,
  publishPrivacyNotice,
  recordPersonalDataAccess,
  recordPrivacyAcceptance,
  resolveArcoRequest,
  searchPeopleForPrivacy,
} from "@/lib/privacy";
import {
  createArcoRequestAction,
  publishPrivacyNoticeAction,
  recordPrivacyAcceptanceAction,
  resolveArcoRequestAction,
  searchPrivacyPeopleAction,
} from "@/lib/privacy/actions";
import { purgeExpiredPersonalData } from "@/lib/privacy/retention";
import { arcoDueOn, PRIVACY_COPY } from "@/lib/privacy/schema";
import { STALE_COMPANY_MESSAGE } from "@/lib/tenant/scope";

import { idsIn, ownerDb, seedTenant, type Tenant } from "./fixtures";
import { actAs } from "./session-state";

let a: Tenant;
let b: Tenant;
let noticeA: { id: string; version: number };
let accessRequestA: { id: string };

const formData = (values: Record<string, string>) => {
  const data = new FormData();

  for (const [key, value] of Object.entries(values)) {
    data.set(key, value);
  }

  return data;
};

const rowsOf = async (companyId: string) => ({
  notices: await ownerDb
    .select()
    .from(privacyNotices)
    .where(eq(privacyNotices.companyId, companyId)),
  acceptances: await ownerDb
    .select()
    .from(privacyNoticeAcceptances)
    .where(eq(privacyNoticeAcceptances.companyId, companyId)),
  arco: await ownerDb
    .select()
    .from(arcoRequests)
    .where(eq(arcoRequests.companyId, companyId)),
  access: await ownerDb
    .select()
    .from(personalDataAccessLog)
    .where(eq(personalDataAccessLog.companyId, companyId)),
});

const callExport = (id: string) =>
  exportRoute(new Request(`http://test/app/privacidad/arco/${id}/exportar`), {
    params: Promise.resolve({ id }),
  });

beforeAll(async () => {
  a = await seedTenant("PA");
  b = await seedTenant("PB");

  const published = await publishPrivacyNotice(
    a.companyId,
    { body: "Aviso de privacidad de la empresa A." },
    a.admin.id,
  );

  if (!published.ok) {
    throw new Error("No se pudo publicar el aviso de la empresa A.");
  }

  noticeA = published.value;

  const created = await createArcoRequest(
    a.companyId,
    {
      personId: a.person.id,
      kind: "access",
      channel: "hr",
      detail: "Quiere una copia de sus datos.",
      receivedOn: "2026-10-01",
    },
    a.admin.id,
  );

  if (!created?.ok) {
    throw new Error("No se pudo registrar la solicitud de la empresa A.");
  }

  accessRequestA = { id: created.value.id };
});

describe("privacy notice stays inside the company", () => {
  it("lib:privacy/getCurrentPrivacyNotice", async () => {
    expect(await getCurrentPrivacyNotice(b.companyId)).toBeNull();
    expect(await getCurrentPrivacyNotice(a.companyId)).toMatchObject({
      id: noticeA.id,
      version: 1,
    });
  });

  it("lib:privacy/listPrivacyNotices", async () => {
    expect(idsIn(await listPrivacyNotices(b.companyId))).not.toContain(
      noticeA.id,
    );
    expect(
      (await listPrivacyNotices(a.companyId)).map((row) => row.id),
    ).toContain(noticeA.id);
  });

  it("lib:privacy/publishPrivacyNotice", async () => {
    const before = await rowsOf(a.companyId);
    const sameText = await publishPrivacyNotice(a.companyId, {
      body: "  Aviso de privacidad de la empresa A.\r\n",
    });

    expect(sameText).toEqual({ ok: false, error: PRIVACY_COPY.noticeSame });

    const inB = await publishPrivacyNotice(
      b.companyId,
      { body: "Aviso de B." },
      b.admin.id,
    );

    expect(inB).toMatchObject({ ok: true, value: { version: 1 } });
    expect((await rowsOf(a.companyId)).notices).toEqual(before.notices);

    const events = await ownerDb
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.resourceId, noticeA.id));

    expect(events.map((event) => event.resourceType)).toEqual([
      "privacy_notice",
    ]);
  });

  it("lib:privacy/pendingPrivacyNotice", async () => {
    expect(
      await pendingPrivacyNotice(a.companyId, a.teammate.id),
    ).toMatchObject({ id: noticeA.id });
    // B's notice is not A's: B's session never sees A's version.
    const pendingInB = await pendingPrivacyNotice(b.companyId, a.person.id);

    expect(pendingInB?.id).not.toBe(noticeA.id);
  });

  it("lib:privacy/recordPrivacyAcceptance", async () => {
    const before = await rowsOf(a.companyId);

    expect(
      await recordPrivacyAcceptance(b.companyId, {
        personId: a.person.id,
        noticeId: noticeA.id,
        channel: "employee_app",
      }),
    ).toBeNull();
    expect((await rowsOf(a.companyId)).acceptances).toEqual(before.acceptances);

    const first = await recordPrivacyAcceptance(a.companyId, {
      personId: a.person.id,
      noticeId: noticeA.id,
      channel: "employee_app",
    });

    expect(first).toMatchObject({ ok: true, value: { version: 1 } });

    const again = await recordPrivacyAcceptance(a.companyId, {
      personId: a.person.id,
      noticeId: noticeA.id,
      channel: "employee_app",
    });

    expect(again).toMatchObject({ ok: true });
    expect(first?.ok && again?.ok && again.value.id).toBe(
      first?.ok ? first.value.id : null,
    );
    expect(await pendingPrivacyNotice(a.companyId, a.person.id)).toBeNull();

    const [stored] = await ownerDb
      .select()
      .from(privacyNoticeAcceptances)
      .where(
        and(
          eq(privacyNoticeAcceptances.companyId, a.companyId),
          eq(privacyNoticeAcceptances.personId, a.person.id),
        ),
      );

    expect(stored).toMatchObject({
      noticeId: noticeA.id,
      channel: "employee_app",
    });
    expect(stored?.acceptedAt).toBeInstanceOf(Date);
  });
});

describe("access log stays inside the company", () => {
  it("lib:privacy/recordPersonalDataAccess", async () => {
    await expect(
      recordPersonalDataAccess(b.companyId, {
        personId: a.person.id,
        resource: "contract_pdf",
        actorKind: "hr_user",
        actorUserId: b.admin.id,
      }),
    ).rejects.toThrow();

    const created = await recordPersonalDataAccess(a.companyId, {
      personId: a.person.id,
      resource: "contract_pdf",
      resourceId: a.contract.id,
      actorKind: "hr_user",
      actorUserId: a.admin.id,
    });

    expect(created).toMatchObject({
      companyId: a.companyId,
      personId: a.person.id,
      resource: "contract_pdf",
    });
  });

  it("lib:privacy/listPersonalDataAccess", async () => {
    const own = await listPersonalDataAccess(a.companyId);

    expect(own.length).toBeGreaterThan(0);
    expect(idsIn(await listPersonalDataAccess(b.companyId))).not.toContain(
      a.person.id,
    );
    expect(
      idsIn(
        await listPersonalDataAccess(b.companyId, { personId: a.person.id }),
      ),
    ).toEqual([]);
  });
});

describe("ARCO requests stay inside the company", () => {
  it("lib:privacy/searchPeopleForPrivacy", async () => {
    expect(
      idsIn(await searchPeopleForPrivacy(b.companyId, "Persona")),
    ).not.toContain(a.person.id);
    expect(
      (await searchPeopleForPrivacy(a.companyId, "Persona PA")).map(
        (row) => row.id,
      ),
    ).toContain(a.person.id);
  });

  it("lib:privacy/createArcoRequest", async () => {
    const before = await rowsOf(a.companyId);

    expect(
      await createArcoRequest(b.companyId, {
        personId: a.person.id,
        kind: "cancellation",
        channel: "hr",
        detail: "Borrar",
        receivedOn: "2026-10-02",
      }),
    ).toBeNull();
    expect((await rowsOf(a.companyId)).arco).toEqual(before.arco);

    const future = await createArcoRequest(
      a.companyId,
      {
        personId: a.person.id,
        kind: "opposition",
        channel: "hr",
        detail: "Oposición",
        receivedOn: "2026-12-31",
      },
      a.admin.id,
      "2026-11-04",
    );

    expect(future).toEqual({ ok: false, error: PRIVACY_COPY.arcoFutureDate });

    const [stored] = (await rowsOf(a.companyId)).arco.filter(
      (row) => row.id === accessRequestA.id,
    );

    expect(stored).toMatchObject({
      status: "received",
      receivedOn: "2026-10-01",
      dueOn: arcoDueOn("2026-10-01"),
    });
    expect(stored?.dueOn).toBe("2026-10-21");
  });

  it("lib:privacy/listArcoRequests", async () => {
    expect(idsIn(await listArcoRequests(b.companyId))).not.toContain(
      accessRequestA.id,
    );
    expect(
      (await listArcoRequests(a.companyId)).map((row) => row.id),
    ).toContain(accessRequestA.id);
  });

  it("lib:privacy/getArcoRequest", async () => {
    expect(await getArcoRequest(b.companyId, accessRequestA.id)).toBeNull();
    expect(await getArcoRequest(a.companyId, accessRequestA.id)).toMatchObject({
      id: accessRequestA.id,
      personId: a.person.id,
    });
  });

  it("lib:privacy/resolveArcoRequest", async () => {
    const created = await createArcoRequest(a.companyId, {
      personId: a.person.id,
      kind: "rectification",
      channel: "employee_app",
      detail: "Mi segundo apellido está mal.",
      receivedOn: "2026-10-05",
    });

    if (!created?.ok) {
      throw new Error("No se pudo preparar la solicitud.");
    }

    const before = await rowsOf(a.companyId);

    expect(
      await resolveArcoRequest(
        b.companyId,
        {
          requestId: created.value.id,
          outcome: "resolved",
          response: "Listo",
        },
        b.admin.id,
      ),
    ).toBeNull();
    expect((await rowsOf(a.companyId)).arco).toEqual(before.arco);

    expect(
      await resolveArcoRequest(
        a.companyId,
        {
          requestId: created.value.id,
          outcome: "resolved",
          response: "Corregimos el apellido.",
        },
        a.admin.id,
      ),
    ).toEqual({ ok: true, value: { id: created.value.id } });
    expect(
      await resolveArcoRequest(a.companyId, {
        requestId: created.value.id,
        outcome: "rejected",
        response: "Otra vez",
      }),
    ).toEqual({ ok: false, error: PRIVACY_COPY.arcoAlreadyClosed });

    const events = await ownerDb
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.resourceId, created.value.id));

    expect(events.map((event) => event.action).sort()).toEqual([
      "approve",
      "create",
    ]);
  });

  it("lib:privacy/buildPersonDataExport", async () => {
    expect(await buildPersonDataExport(b.companyId, a.person.id)).toBeNull();

    const data = await buildPersonDataExport(a.companyId, a.person.id);

    expect(data?.person.id).toBe(a.person.id);
    expect(data?.contracts.map((row) => row.id)).toContain(a.contract.id);
    expect(data?.arcoRequests.map((row) => row.id)).toContain(
      accessRequestA.id,
    );
    expect(data?.privacyAcceptances).toEqual([
      expect.objectContaining({ version: 1, channel: "employee_app" }),
    ]);
    expect(idsIn(data)).not.toContain(b.person.id);
    expect(idsIn(data)).not.toContain(b.companyId);
  });

  it("route:GET /app/privacidad/arco/[id]/exportar", async () => {
    const before = await rowsOf(a.companyId);

    actAs(b.admin);
    expect((await callExport(accessRequestA.id)).status).toBe(404);
    expect((await callExport("no-es-uuid")).status).toBe(404);
    expect((await rowsOf(a.companyId)).access).toEqual(before.access);

    actAs(a.viewer);
    expect((await callExport(accessRequestA.id)).status).toBe(403);

    actAs(a.admin);
    const response = await callExport(accessRequestA.id);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("arco-");

    const body = (await response.json()) as { person: { id: string } };

    expect(body.person.id).toBe(a.person.id);

    const logged = (await rowsOf(a.companyId)).access.filter(
      (row) => row.resource === "arco_export",
    );

    expect(logged).toEqual([
      expect.objectContaining({
        personId: a.person.id,
        resourceId: accessRequestA.id,
        actorUserId: a.admin.id,
      }),
    ]);
  });
});

describe("retention stays inside the company", () => {
  it("lib:privacy/retention/purgeExpiredPersonalData", async () => {
    const old = new Date("2020-01-01T00:00:00Z");
    const [oldA] = await ownerDb
      .insert(personalDataAccessLog)
      .values({
        companyId: a.companyId,
        personId: a.person.id,
        resource: "payroll_receipt",
        actorKind: "employee",
        accessedAt: old,
      })
      .returning();
    const [oldB] = await ownerDb
      .insert(personalDataAccessLog)
      .values({
        companyId: b.companyId,
        personId: b.person.id,
        resource: "payroll_receipt",
        actorKind: "employee",
        accessedAt: old,
      })
      .returning();
    const [closedLongAgo] = await ownerDb
      .insert(arcoRequests)
      .values({
        companyId: a.companyId,
        personId: a.person.id,
        kind: "opposition",
        status: "resolved",
        channel: "hr",
        detail: "Vieja",
        response: "Atendida",
        receivedOn: "2019-01-01",
        dueOn: "2019-01-21",
        resolvedAt: old,
      })
      .returning();
    const [openLongAgo] = await ownerDb
      .insert(arcoRequests)
      .values({
        companyId: a.companyId,
        personId: a.person.id,
        kind: "access",
        channel: "hr",
        detail: "Abierta",
        receivedOn: "2019-01-01",
        dueOn: "2019-01-21",
      })
      .returning();

    const result = await purgeExpiredPersonalData(b.companyId, {
      batchSize: 1,
    });

    expect(result).toEqual({ accessLog: 1, arcoRequests: 0, more: false });

    const remainingA = await rowsOf(a.companyId);

    expect(remainingA.access.map((row) => row.id)).toContain(oldA.id);
    expect(remainingA.arco.map((row) => row.id)).toContain(closedLongAgo.id);
    expect(
      (await rowsOf(b.companyId)).access.map((row) => row.id),
    ).not.toContain(oldB.id);

    const inA = await purgeExpiredPersonalData(a.companyId);

    expect(inA).toMatchObject({ accessLog: 1, arcoRequests: 1 });

    const afterA = await rowsOf(a.companyId);

    expect(afterA.access.map((row) => row.id)).not.toContain(oldA.id);
    expect(afterA.arco.map((row) => row.id)).not.toContain(closedLongAgo.id);
    // An open request is never deleted, however old.
    expect(afterA.arco.map((row) => row.id)).toContain(openLongAgo.id);
    // Recent reads stay.
    expect(afterA.access.length).toBeGreaterThan(0);
  });
});

describe("privacy actions with company B's session", () => {
  it("action:privacy/publishPrivacyNoticeAction", async () => {
    const before = await rowsOf(a.companyId);

    actAs(b.admin);
    expect(
      await publishPrivacyNoticeAction(
        {},
        formData({ companyId: a.companyId, body: "Aviso nuevo" }),
      ),
    ).toEqual({ error: STALE_COMPANY_MESSAGE });
    expect((await rowsOf(a.companyId)).notices).toEqual(before.notices);
  });

  it("action:privacy/recordPrivacyAcceptanceAction", async () => {
    const before = await rowsOf(a.companyId);

    actAs(b.admin);
    expect(
      await recordPrivacyAcceptanceAction(
        {},
        formData({
          companyId: a.companyId,
          personId: a.teammate.id,
          noticeId: noticeA.id,
        }),
      ),
    ).toEqual({ error: STALE_COMPANY_MESSAGE });
    expect(
      await recordPrivacyAcceptanceAction(
        {},
        formData({ personId: a.teammate.id, noticeId: noticeA.id }),
      ),
    ).toEqual({ error: PRIVACY_COPY.personNotFound });
    expect((await rowsOf(a.companyId)).acceptances).toEqual(before.acceptances);
  });

  it("action:privacy/createArcoRequestAction", async () => {
    const before = await rowsOf(a.companyId);

    actAs(b.admin);
    expect(
      await createArcoRequestAction(
        {},
        formData({
          companyId: a.companyId,
          personId: a.person.id,
          kind: "access",
          detail: "Copia",
          receivedOn: "2026-10-10",
        }),
      ),
    ).toEqual({ error: STALE_COMPANY_MESSAGE });
    expect(
      await createArcoRequestAction(
        {},
        formData({
          personId: a.person.id,
          kind: "access",
          detail: "Copia",
          receivedOn: "2026-10-10",
        }),
      ),
    ).toEqual({ error: PRIVACY_COPY.personNotFound });
    expect((await rowsOf(a.companyId)).arco).toEqual(before.arco);
  });

  it("action:privacy/resolveArcoRequestAction", async () => {
    const before = await rowsOf(a.companyId);

    actAs(b.admin);
    expect(
      await resolveArcoRequestAction(
        {},
        formData({
          requestId: accessRequestA.id,
          outcome: "resolved",
          response: "Listo",
        }),
      ),
    ).toEqual({ error: PRIVACY_COPY.arcoNotFound });
    expect((await rowsOf(a.companyId)).arco).toEqual(before.arco);
  });

  it("action:privacy/searchPrivacyPeopleAction", async () => {
    actAs(b.admin);
    expect(idsIn(await searchPrivacyPeopleAction("Persona"))).not.toContain(
      a.person.id,
    );
  });
});

describe("privacy permissions", () => {
  it("rbac:action:privacy/searchPrivacyPeopleAction", async () => {
    actAs(a.viewer);
    expect(await searchPrivacyPeopleAction("Persona")).toEqual([]);
    actAs(a.admin);
    expect(
      (await searchPrivacyPeopleAction("Persona PA")).map((row) => row.id),
    ).toContain(a.person.id);
  });

  it("rbac:route:GET /app/privacidad/arco/[id]/exportar", async () => {
    actAs(a.viewer);
    expect((await callExport(accessRequestA.id)).status).toBe(403);
    actAs(a.editor);
    expect((await callExport(accessRequestA.id)).status).toBe(403);
  });

  it("rbac:action:privacy/publishPrivacyNoticeAction", async () => {
    const before = await rowsOf(b.companyId);

    actAs(b.viewer);
    expect(
      await publishPrivacyNoticeAction({}, formData({ body: "Aviso v2" })),
    ).toEqual({ error: PRIVACY_COPY.denied });
    actAs(b.editor);
    expect(
      await publishPrivacyNoticeAction({}, formData({ body: "Aviso v2" })),
    ).toEqual({ error: PRIVACY_COPY.denied });
    expect((await rowsOf(b.companyId)).notices).toEqual(before.notices);

    actAs(b.admin);
    expect(
      await publishPrivacyNoticeAction({}, formData({ body: "Aviso v2" })),
    ).toMatchObject({ ok: true });
  });

  it("rbac:action:privacy/recordPrivacyAcceptanceAction", async () => {
    const current = await getCurrentPrivacyNotice(b.companyId);

    actAs(b.viewer);
    expect(
      await recordPrivacyAcceptanceAction(
        {},
        formData({ personId: b.person.id, noticeId: current!.id }),
      ),
    ).toEqual({ error: PRIVACY_COPY.denied });
    expect(await pendingPrivacyNotice(b.companyId, b.person.id)).not.toBeNull();

    actAs(b.admin);
    expect(
      await recordPrivacyAcceptanceAction(
        {},
        formData({ personId: b.person.id, noticeId: current!.id }),
      ),
    ).toMatchObject({ ok: true });

    const [stored] = await ownerDb
      .select()
      .from(privacyNoticeAcceptances)
      .where(eq(privacyNoticeAcceptances.personId, b.person.id));

    expect(stored).toMatchObject({ channel: "hr", recordedBy: b.admin.id });
  });

  it("rbac:action:privacy/createArcoRequestAction", async () => {
    const before = await rowsOf(b.companyId);
    const fields = {
      personId: b.person.id,
      kind: "cancellation",
      detail: "Que borren mi teléfono.",
      receivedOn: "2026-10-15",
    };

    actAs(b.viewer);
    expect(await createArcoRequestAction({}, formData(fields))).toEqual({
      error: PRIVACY_COPY.denied,
    });
    expect((await rowsOf(b.companyId)).arco).toEqual(before.arco);

    actAs(b.admin);
    expect(await createArcoRequestAction({}, formData(fields))).toMatchObject({
      ok: true,
    });
  });

  it("rbac:action:privacy/resolveArcoRequestAction", async () => {
    const [open] = (await rowsOf(b.companyId)).arco.filter(
      (row) => row.status === "received",
    );

    actAs(b.viewer);
    expect(
      await resolveArcoRequestAction(
        {},
        formData({
          requestId: open.id,
          outcome: "rejected",
          response: "No procede",
        }),
      ),
    ).toEqual({ error: PRIVACY_COPY.denied });

    actAs(b.admin);
    expect(
      await resolveArcoRequestAction(
        {},
        formData({
          requestId: open.id,
          outcome: "rejected",
          response: "No procede: es un dato de nómina vigente.",
        }),
      ),
    ).toMatchObject({ ok: true });
  });
});
