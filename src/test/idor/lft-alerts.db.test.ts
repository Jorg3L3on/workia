/**
 * LFT alerts (Workia 2.0 W2-19) on a real database. Three unjustified faltas
 * in 30 days warn HR and the person's manager, a fourth is the LFT article
 * 47-X threshold, a contract ending in 30 days and a document expiring in 30
 * days are alerted; each alert is logged once in lft_alerts with its
 * in-app/email/push messages. Company B never alerts on, reads or claims
 * company A's people or log. Titles are the surface ids of
 * docs/idor-matrix.md.
 */
import { and, eq, inArray } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.CRON_SECRET = "cron-secret-for-tests-0123456789";
});

import { GET as cronLftAlerts } from "@/app/api/cron/lft-alerts/route";
import {
  documentRequirements,
  LFT_ALERT_KINDS,
  lftAlertRuns,
  lftAlerts,
  notifications,
  personDocuments,
  personEvents,
} from "@/lib/db/schema";
import { isoToday } from "@/lib/format/date";
import { addDays } from "@/lib/incidencias/days";
import {
  alertAbsences,
  listLftAlerts,
  runLftAlerts,
  runLftAlertsIfDue,
} from "@/lib/lft-alerts";
import { runLftAlertsNowAction } from "@/lib/lft-alerts/actions";
import { LFT_ALERTS_COPY } from "@/lib/lft-alerts/copy";
import { quincenaOf } from "@/lib/pay-periods/quincena";
import { STALE_COMPANY_MESSAGE } from "@/lib/tenant/scope";
import { unjustifiedFaltaDays } from "@/lib/timeline/aggregates";
import { replacePeriodIncidencias } from "@/lib/timeline/writers";

import { ownerDb, seedTenant, type Tenant } from "./fixtures";
import { actAs } from "./session-state";

let a: Tenant;
let b: Tenant;
const TODAY = isoToday();
const ago = (days: number) => addDays(TODAY, -days);

const formData = (values: Record<string, string> = {}) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

/**
 * Writes a person's faltas (replacing their incidencias in every quincena
 * touched): `days` unjustified, `justified` with a permiso.
 */
const setFaltas = async (
  tenant: Tenant,
  personId: string,
  days: string[],
  justified: string[] = [],
) => {
  const all = [
    ...days.map((day) => ({ day, justified: false })),
    ...justified.map((day) => ({ day, justified: true })),
  ];
  const periods = new Set(
    [...all.map(({ day }) => day), ...[0, 15, 30, 45, 59].map(ago)].map(
      quincenaOf,
    ),
  );

  for (const period of periods) {
    await replacePeriodIncidencias(tenant.companyId, {
      period,
      personIds: [personId],
      incidencias: all
        .filter(({ day }) => quincenaOf(day) === period)
        .map(({ day, justified: isJustified }) => ({
          personId,
          day,
          kind: "falta" as const,
          justified: isJustified,
          justificationRef: isJustified ? "permiso_con_goce:test" : null,
          source: "engine" as const,
        })),
    });
  }
};

const alertsOf = (tenant: Tenant, personId?: string) =>
  ownerDb
    .select()
    .from(lftAlerts)
    .where(
      and(
        eq(lftAlerts.companyId, tenant.companyId),
        personId ? eq(lftAlerts.personId, personId) : undefined,
      ),
    );

const messagesOf = (tenant: Tenant, template: string) =>
  ownerDb
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.companyId, tenant.companyId),
        eq(notifications.template, template as "absence_warning"),
      ),
    );

beforeAll(async () => {
  a = await seedTenant("LA");
  b = await seedTenant("LB");
});

beforeEach(() => {
  actAs(null);
});

describe("absences (LFT article 47, section X)", () => {
  beforeEach(async () => {
    await ownerDb.delete(lftAlerts).where(eq(lftAlerts.companyId, a.companyId));
    await ownerDb
      .delete(notifications)
      .where(eq(notifications.companyId, a.companyId));
  });

  it("two faltas, or justified ones, alert nobody", async () => {
    await setFaltas(a, a.teammate.id, [ago(2), ago(5)], [ago(7), ago(9)]);

    expect(
      await runLftAlerts(a.companyId, { today: TODAY, checks: ["absences"] }),
    ).toMatchObject({ sent: 0 });
    expect(await alertsOf(a, a.teammate.id)).toHaveLength(0);
  });

  it("three unjustified faltas in 30 days warn HR and the manager, once, and are logged", async () => {
    await setFaltas(a, a.teammate.id, [ago(20), ago(10), ago(3)], [ago(7)]);

    const first = await runLftAlerts(a.companyId, {
      today: TODAY,
      checks: ["absences"],
    });

    expect(first.byKind.absence_warning).toBe(1);

    const [logged] = await alertsOf(a, a.teammate.id);

    expect(logged).toMatchObject({
      kind: "absence_warning",
      subjectKey: ago(3),
      dueOn: ago(3),
      managerNotified: true,
    });
    expect(logged!.hrRecipients).toBeGreaterThanOrEqual(1);
    expect(logged!.details).toMatchObject({
      count: 3,
      from: addDays(ago(3), -29),
      to: ago(3),
      days: [ago(20), ago(10), ago(3)],
    });

    const messages = await messagesOf(a, "absence_warning");

    // HR (admin holds pay_periods:read) and the manager (a.person).
    expect(messages.map((row) => row.recipientUserId)).toContain(a.admin.id);
    expect(messages.map((row) => row.recipientPersonId)).toContain(a.person.id);
    expect(messages.map((row) => row.recipientUserId)).not.toContain(
      a.viewer.id,
    );
    for (const message of messages) {
      expect(message.body).toContain("más de tres faltas");
      expect(message.body).toContain("30 días");
      expect(message.body).toContain("artículo 47, fracción X");
    }

    // Again: nothing new.
    expect(
      await runLftAlerts(a.companyId, { today: TODAY, checks: ["absences"] }),
    ).toMatchObject({ sent: 0 });
    expect(await alertsOf(a, a.teammate.id)).toHaveLength(1);
  });

  it("a fourth falta within the 30 days reaches the threshold", async () => {
    await setFaltas(a, a.teammate.id, [ago(20), ago(10), ago(3)]);
    await runLftAlerts(a.companyId, { today: TODAY, checks: ["absences"] });
    await setFaltas(a, a.teammate.id, [ago(20), ago(10), ago(3), ago(1)]);

    const result = await runLftAlerts(a.companyId, {
      today: TODAY,
      checks: ["absences"],
    });

    expect(result.byKind).toMatchObject({
      absence_warning: 0,
      absence_threshold: 1,
    });

    const [message] = await messagesOf(a, "absence_threshold");

    expect(message!.title).toContain("más de tres faltas");
    expect(message!.body).toContain("4 faltas sin justificar");
    expect(message!.body).toContain("no decide ni redacta una rescisión");
  });

  it("faltas more than 30 days apart do not add up", async () => {
    await setFaltas(a, a.teammate.id, [ago(58), ago(40), ago(2)]);

    expect(
      await runLftAlerts(a.companyId, { today: TODAY, checks: ["absences"] }),
    ).toMatchObject({ sent: 0 });
  });

  it("the absence check after punches only looks at the people touched", async () => {
    await setFaltas(a, a.teammate.id, [ago(12), ago(8), ago(4)]);

    expect(
      await alertAbsences(a.companyId, { personIds: [a.person.id] }),
    ).toMatchObject({ sent: 0 });
    expect(
      await alertAbsences(a.companyId, { personIds: [a.teammate.id] }),
    ).toMatchObject({ sent: 1 });
  });
});

describe("contracts and documents", () => {
  it("a contract of the renewal tray ending in 30 days goes to HR and is logged once", async () => {
    // The fixture contract ends in 10 days with a one-month notice window.
    const first = await runLftAlerts(a.companyId, { checks: ["contracts"] });

    expect(first.byKind.contract_ending).toBe(1);

    const rows = (await alertsOf(a, a.person.id)).filter(
      (row) => row.kind === "contract_ending",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.subjectKey).toBe(`${a.contract.id}:${a.contract.endDate}`);

    const messages = await messagesOf(a, "contract_ending");
    const users = messages.map((row) => row.recipientUserId);

    // contracts:update: admin and editor, not the viewer.
    expect(users).toEqual(expect.arrayContaining([a.admin.id, a.editor.id]));
    expect(users).not.toContain(a.viewer.id);
    expect(
      await runLftAlerts(a.companyId, { checks: ["contracts"] }),
    ).toMatchObject({ sent: 0 });
  });

  it("a document expiring in 30 days goes to HR and the manager", async () => {
    const [requirement] = await ownerDb
      .insert(documentRequirements)
      .values({ companyId: a.companyId, name: "Licencia de manejo" })
      .returning();
    await ownerDb.insert(personDocuments).values({
      companyId: a.companyId,
      personId: a.teammate.id,
      requirementId: requirement!.id,
      deliveredOn: ago(300),
      expiresOn: addDays(TODAY, 12),
    });

    const result = await runLftAlerts(a.companyId, { checks: ["documents"] });

    expect(result.byKind.document_expiring).toBe(1);

    const [logged] = (await alertsOf(a, a.teammate.id)).filter(
      (row) => row.kind === "document_expiring",
    );

    expect(logged).toMatchObject({
      dueOn: addDays(TODAY, 12),
      managerNotified: true,
    });

    const messages = await messagesOf(a, "document_expiring");

    expect(messages.map((row) => row.recipientPersonId)).toContain(a.person.id);
    expect(messages[0]!.body).toContain("Licencia de manejo");
  });
});

describe("company B never touches company A's alerts", () => {
  it("lib:lft-alerts/runLftAlerts", async () => {
    await setFaltas(a, a.teammate.id, [ago(9), ago(6), ago(3)]);
    const before = await alertsOf(b);

    expect(
      await runLftAlerts(b.companyId, { personIds: [a.teammate.id] }),
    ).toMatchObject({ sent: 0 });
    expect(await alertsOf(b)).toEqual(before);
  });

  it("lib:lft-alerts/alertAbsences", async () => {
    expect(
      await alertAbsences(b.companyId, { personIds: [a.teammate.id] }),
    ).toMatchObject({ sent: 0 });
  });

  it("lib:timeline/aggregates/unjustifiedFaltaDays", async () => {
    await setFaltas(a, a.teammate.id, [ago(9), ago(6), ago(3)]);

    expect(
      await unjustifiedFaltaDays(
        a.companyId,
        { from: ago(30), to: TODAY },
        { personIds: [a.teammate.id] },
      ),
    ).toHaveLength(3);
    expect(
      await unjustifiedFaltaDays(
        b.companyId,
        { from: ago(30), to: TODAY },
        { personIds: [a.teammate.id] },
      ),
    ).toEqual([]);
  });

  it("lib:lft-alerts/listLftAlerts", async () => {
    await runLftAlerts(a.companyId);
    const aIds = (await alertsOf(a)).map((row) => row.id);

    expect(aIds.length).toBeGreaterThan(0);

    const page = await listLftAlerts(b.companyId, {
      kinds: LFT_ALERT_KINDS,
    });

    expect(page.items.some((item) => aIds.includes(item.id))).toBe(false);

    const own = await listLftAlerts(a.companyId, {
      kinds: ["contract_ending"],
    });

    expect(own.items.every((item) => item.kind === "contract_ending")).toBe(
      true,
    );
    expect(await listLftAlerts(a.companyId, { kinds: [] })).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("lib:lft-alerts/runLftAlertsIfDue", async () => {
    await ownerDb
      .delete(lftAlertRuns)
      .where(inArray(lftAlertRuns.companyId, [a.companyId, b.companyId]));

    const now = new Date();

    expect(await runLftAlertsIfDue(b.companyId, now)).not.toBeNull();
    // Claimed: not due again within the interval.
    expect(await runLftAlertsIfDue(b.companyId, now)).toBeNull();

    const runs = await ownerDb
      .select()
      .from(lftAlertRuns)
      .where(inArray(lftAlertRuns.companyId, [a.companyId, b.companyId]));

    expect(runs.map((row) => row.companyId)).toEqual([b.companyId]);
    // B's daily recompute wrote no incidencia for A's people.
    const aEventsFromB = await ownerDb
      .select({ id: personEvents.id })
      .from(personEvents)
      .where(
        and(
          eq(personEvents.companyId, b.companyId),
          inArray(personEvents.personId, [a.person.id, a.teammate.id]),
        ),
      );

    expect(aEventsFromB).toEqual([]);
  });

  it("action:lft-alerts/runLftAlertsNowAction", async () => {
    actAs(b.admin);
    expect(
      await runLftAlertsNowAction({}, formData({ companyId: a.companyId })),
    ).toEqual({ error: STALE_COMPANY_MESSAGE });

    actAs(a.admin);
    expect(await runLftAlertsNowAction({}, formData())).toMatchObject({
      ok: true,
    });
  });

  it("rbac:action:lft-alerts/runLftAlertsNowAction", async () => {
    actAs(a.viewer);
    expect(await runLftAlertsNowAction({}, formData())).toEqual({
      error: LFT_ALERTS_COPY.forbidden,
    });
  });

  it("route:GET /api/cron/lft-alerts", async () => {
    const call = (authorization?: string) =>
      cronLftAlerts(
        new Request("https://workia.test/api/cron/lft-alerts", {
          headers: authorization ? { authorization } : {},
        }),
      );

    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong-secret-0123456789")).status).toBe(401);

    const response = await call("Bearer cron-secret-for-tests-0123456789");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      companies: expect.any(Number),
      sent: expect.any(Number),
    });
  });
});
