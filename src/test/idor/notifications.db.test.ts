/**
 * Notifications (Workia 2.0 W2-08) on a real database. Every template writes
 * its in-app message and a delivery log; a failed email retries with backoff
 * while the message stays in the inbox; opt-outs skip a channel; web push
 * goes to the person's devices and forgets the ones the push service drops.
 * Cross-company and cross-person: company B's session, or a teammate, never
 * reads, marks, sends or changes company A's messages, opt-outs or devices.
 * Titles are the surface ids of docs/idor-matrix.md.
 */
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => {
  process.env.VAPID_PUBLIC_KEY =
    "BPublicKeyForTestsOnly_0123456789abcdefghijklmnop";
  process.env.VAPID_PRIVATE_KEY = "PrivateKeyForTestsOnly_0123456789abcdef";
  process.env.VAPID_SUBJECT = "mailto:pruebas@workia.test";
  process.env.CRON_SECRET = "cron-secret-for-tests-0123456789";

  return {
    sent: [] as { to: string; subject: string; text: string }[],
    failEmail: false,
    employee: null as null | {
      accountId: string;
      companyId: string;
      personId: string;
    },
  };
});

vi.mock("@/lib/email", () => {
  class EmailNotConfiguredError extends Error {}

  return {
    EmailNotConfiguredError,
    emailConfigured: () => true,
    sendEmail: async (message: {
      to: string;
      subject: string;
      text: string;
    }) => {
      if (jar.failEmail) {
        throw new Error("SMTP 421 try again later");
      }
      jar.sent.push(message);
    },
  };
});

vi.mock("@/lib/employee-accounts/session", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/employee-accounts/session")>();
  const { NavigationThrow } = await import("@/test/idor/session-state");

  return {
    ...actual,
    getEmployeeContext: async () => jar.employee,
    requireEmployeeContext: async () => {
      if (!jar.employee) {
        throw new NavigationThrow("redirect", "/mi/entrar");
      }
      return jar.employee;
    },
  };
});

import { GET as cronSweep } from "@/app/api/cron/notifications/route";
import {
  DELETE as deletePushRoute,
  POST as postPushRoute,
} from "@/app/api/mi/push/route";
import {
  employeeAccounts,
  notificationDeliveries,
  notificationOptOuts,
  notifications,
  pushSubscriptions,
} from "@/lib/db/schema";
import { NOTIFICATION_TEMPLATES } from "@/lib/db/schema/notifications";
import {
  countUnread,
  createNotifications,
  hrRecipientsWithPermission,
  listInboxPage,
  listOptOuts,
  managerRecipientOf,
  markAllNotificationsRead,
  markNotificationRead,
  notify,
  personRecipient,
  setChannelEnabled,
  userRecipient,
  type NotifyInput,
} from "@/lib/notifications";
import {
  markAllEmployeeNotificationsReadAction,
  markAllUserNotificationsReadAction,
  openEmployeeNotificationAction,
  openUserNotificationAction,
  setEmployeeChannelAction,
  setUserEmailChannelAction,
} from "@/lib/notifications/actions";
import {
  MAX_ATTEMPTS,
  pruneOldNotifications,
  sendDueNotifications,
  sendNotificationsSoon,
} from "@/lib/notifications/delivery";
import {
  deletePushSubscription,
  pushSender,
  savePushSubscription,
  sendPushToPerson,
} from "@/lib/notifications/push";
import type { NotificationTemplate } from "@/lib/db/schema";

import { ownerDb, seedTenant, type Tenant } from "./fixtures";
import { actAs, NavigationThrow } from "./session-state";

let a: Tenant;
let b: Tenant;
const accounts = {} as Record<"aPerson" | "aTeammate" | "bPerson", string>;
const emailOf = (tenant: Tenant, who: string) =>
  `${who}.${tenant.label.toLowerCase()}@avisos.test`;

const SAMPLE_DATA: { [T in NotificationTemplate]: NotifyInput<T>["data"] } = {
  receipt_available: { period: "1.ª quincena de noviembre de 2026" },
  request_decision: {
    request: "vacaciones",
    decision: "aprobada",
    from: "2026-12-21",
    to: "2026-12-24",
  },
  document_rejected: { document: "INE", reason: "La foto no se lee." },
  contract_ending: {
    personId: "00000000-0000-4000-8000-000000000001",
    personName: "Ana López",
    endDate: "2026-11-30",
  },
  request_pending: {
    requesterName: "Luis Pérez",
    request: "permiso",
    from: "2026-11-10",
    to: "2026-11-10",
  },
  absence_warning: {
    personId: "00000000-0000-4000-8000-000000000001",
    personName: "Ana López",
    count: 3,
    from: "2026-10-08",
    to: "2026-11-06",
  },
  absence_threshold: {
    personId: "00000000-0000-4000-8000-000000000001",
    personName: "Ana López",
    count: 4,
    from: "2026-10-08",
    to: "2026-11-06",
  },
  document_expiring: {
    personId: "00000000-0000-4000-8000-000000000001",
    personName: "Ana López",
    document: "Licencia de manejo",
    expiresOn: "2026-11-30",
  },
};

const notifyPerson = async (
  tenant: Tenant,
  personId: string,
  template: NotificationTemplate = "receipt_available",
  eventKey?: string,
) => {
  const [id] = await createNotifications(tenant.companyId, {
    template,
    data: SAMPLE_DATA[template] as never,
    recipients: [personRecipient(personId)],
    eventKey,
  });
  return id!;
};

const deliveriesOf = (notificationId: string) =>
  ownerDb
    .select()
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.notificationId, notificationId));

const deliveryOf = async (notificationId: string, channel: string) =>
  (await deliveriesOf(notificationId)).find((row) => row.channel === channel)!;

const notificationRow = async (id: string) =>
  (
    await ownerDb.select().from(notifications).where(eq(notifications.id, id))
  )[0];

/** Makes every pending delivery of the company due now. */
const makeDue = (companyId: string) =>
  ownerDb
    .update(notificationDeliveries)
    .set({ nextAttemptAt: new Date(Date.now() - 1000) })
    .where(
      and(
        eq(notificationDeliveries.companyId, companyId),
        eq(notificationDeliveries.status, "pending"),
      ),
    );

const formData = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

const redirectOf = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    if (error instanceof NavigationThrow) return error.url ?? error.kind;
    throw error;
  }
  return null;
};

const subscription = (n: string) => ({
  endpoint: `https://push.example/send/${n}`,
  keys: {
    p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQ",
    auth: "tBHItJI5svbpez7KI4CCXg",
  },
});

const pushRequest = (method: "POST" | "DELETE", body: unknown) =>
  new NextRequest("https://workia.test/api/mi/push", {
    method,
    headers: { "content-type": "application/json", "user-agent": "Prueba" },
    body: JSON.stringify(body),
  });

const actAsEmployee = (tenant: Tenant, who: "person" | "teammate") => {
  jar.employee = {
    accountId:
      who === "person"
        ? tenant === a
          ? accounts.aPerson
          : accounts.bPerson
        : accounts.aTeammate,
    companyId: tenant.companyId,
    personId: tenant[who].id,
  };
};

const pushCalls: string[] = [];
let pushFailure: null | { statusCode: number } = null;

beforeAll(async () => {
  a = await seedTenant("NA");
  b = await seedTenant("NB");

  const account = async (tenant: Tenant, personId: string, who: string) => {
    const [row] = await ownerDb
      .insert(employeeAccounts)
      .values({
        companyId: tenant.companyId,
        personId,
        status: "active",
        email: emailOf(tenant, who),
        emailVerifiedAt: new Date(),
        activatedAt: new Date(),
      })
      .returning();
    return row!.id;
  };

  accounts.aPerson = await account(a, a.person.id, "ana");
  accounts.aTeammate = await account(a, a.teammate.id, "teo");
  accounts.bPerson = await account(b, b.person.id, "beto");

  pushSender.send = async (target) => {
    pushCalls.push(target.endpoint);
    if (pushFailure) {
      throw Object.assign(new Error("push failed"), pushFailure);
    }
  };
});

beforeEach(async () => {
  jar.sent.length = 0;
  jar.failEmail = false;
  jar.employee = null;
  pushCalls.length = 0;
  pushFailure = null;
  actAs(null);
  for (const companyId of [a.companyId, b.companyId]) {
    await ownerDb
      .delete(notifications)
      .where(eq(notifications.companyId, companyId));
    await ownerDb
      .delete(notificationOptOuts)
      .where(eq(notificationOptOuts.companyId, companyId));
    await ownerDb
      .delete(pushSubscriptions)
      .where(eq(pushSubscriptions.companyId, companyId));
  }
});

describe("sending", () => {
  it.each(NOTIFICATION_TEMPLATES)(
    "%s writes the in-app message and a delivery log entry per channel",
    async (template) => {
      const id = await notifyPerson(a, a.person.id, template);
      const before = await deliveriesOf(id);

      expect(
        Object.fromEntries(before.map((row) => [row.channel, row.status])),
      ).toEqual({ in_app: "sent", email: "pending", push: "pending" });

      await sendDueNotifications(a.companyId);

      expect(await deliveryOf(id, "email")).toMatchObject({
        status: "sent",
        attempts: 1,
      });
      // No phone subscribed yet: logged, not retried.
      expect(await deliveryOf(id, "push")).toMatchObject({
        status: "skipped",
        lastError: "no_device",
      });
      expect(jar.sent.map((sent) => sent.to)).toEqual([emailOf(a, "ana")]);
    },
  );

  it("a failed email retries, and the message stays in the in-app inbox", async () => {
    const id = await notifyPerson(a, a.person.id);
    jar.failEmail = true;

    await sendDueNotifications(a.companyId);

    const retry = await deliveryOf(id, "email");
    expect(retry).toMatchObject({
      status: "pending",
      attempts: 1,
      lastError: "SMTP 421 try again later",
    });
    expect(retry.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    const inbox = await listInboxPage(
      a.companyId,
      personRecipient(a.person.id),
    );
    expect(inbox.items.map((item) => item.id)).toEqual([id]);

    // Not due yet: a new run leaves it alone.
    await sendDueNotifications(a.companyId);
    expect((await deliveryOf(id, "email")).attempts).toBe(1);

    jar.failEmail = false;
    await makeDue(a.companyId);
    await sendDueNotifications(a.companyId);

    expect(await deliveryOf(id, "email")).toMatchObject({
      status: "sent",
      attempts: 2,
      lastError: null,
    });
    expect(jar.sent).toHaveLength(1);
  });

  it("gives up after the last attempt and keeps the inbox message", async () => {
    const id = await notifyPerson(a, a.person.id);
    jar.failEmail = true;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      await makeDue(a.companyId);
      await sendDueNotifications(a.companyId);
    }

    expect(await deliveryOf(id, "email")).toMatchObject({
      status: "failed",
      attempts: MAX_ATTEMPTS,
      nextAttemptAt: null,
    });
    expect(await countUnread(a.companyId, personRecipient(a.person.id))).toBe(
      1,
    );
  });

  it("the same event creates one message per recipient", async () => {
    const first = await notifyPerson(
      a,
      a.person.id,
      "request_decision",
      "vr:1",
    );
    const again = await createNotifications(a.companyId, {
      template: "request_decision",
      data: SAMPLE_DATA.request_decision,
      recipients: [
        personRecipient(a.person.id),
        personRecipient(a.teammate.id),
      ],
      eventKey: "vr:1",
    });

    expect(first).toBeTruthy();
    expect(again).toHaveLength(1);
    expect(
      (
        await ownerDb
          .select()
          .from(notifications)
          .where(eq(notifications.companyId, a.companyId))
      ).length,
    ).toBe(2);
  });

  it("an opted-out channel is logged as skipped, the inbox still gets it", async () => {
    const pending = await notifyPerson(a, a.person.id);
    await setChannelEnabled(
      a.companyId,
      personRecipient(a.person.id),
      "email",
      false,
    );
    const later = await notifyPerson(a, a.person.id);
    await sendDueNotifications(a.companyId);

    for (const id of [pending, later]) {
      expect(await deliveryOf(id, "email")).toMatchObject({
        status: "skipped",
        lastError: "opted_out",
      });
    }
    expect(jar.sent).toHaveLength(0);
    expect(await countUnread(a.companyId, personRecipient(a.person.id))).toBe(
      2,
    );
  });

  it("sends web push to the person's phones and forgets the ones gone", async () => {
    await savePushSubscription(a.companyId, a.person.id, subscription("a1"));
    const id = await notifyPerson(a, a.person.id);
    await sendDueNotifications(a.companyId);

    expect(pushCalls).toEqual(["https://push.example/send/a1"]);
    expect((await deliveryOf(id, "push")).status).toBe("sent");

    pushFailure = { statusCode: 410 };
    const next = await notifyPerson(a, a.person.id);
    await sendDueNotifications(a.companyId);

    expect(await deliveryOf(next, "push")).toMatchObject({
      status: "skipped",
      lastError: "no_device",
    });
    expect(
      await ownerDb
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.companyId, a.companyId)),
    ).toHaveLength(0);
  });

  it("a push service error retries the delivery", async () => {
    await savePushSubscription(a.companyId, a.person.id, subscription("a2"));
    pushFailure = { statusCode: 503 };
    const id = await notifyPerson(a, a.person.id);
    await sendDueNotifications(a.companyId);

    expect(await deliveryOf(id, "push")).toMatchObject({
      status: "pending",
      attempts: 1,
    });
  });

  it("HR users get email and in-app, and no push row", async () => {
    const [id] = await createNotifications(a.companyId, {
      template: "contract_ending",
      data: SAMPLE_DATA.contract_ending,
      recipients: [userRecipient(a.admin.id)],
    });
    await sendDueNotifications(a.companyId);

    expect(
      Object.fromEntries(
        (await deliveriesOf(id!)).map((row) => [row.channel, row.status]),
      ),
    ).toEqual({ in_app: "sent", email: "sent" });
    expect(jar.sent[0]).toMatchObject({ to: a.admin.email });
    expect((await notificationRow(id!))!.url).toBe(
      "/app/personas/00000000-0000-4000-8000-000000000001",
    );
  });

  it("refuses a link outside the app", async () => {
    await expect(
      createNotifications(a.companyId, {
        template: "receipt_available",
        data: SAMPLE_DATA.receipt_available,
        recipients: [personRecipient(a.person.id)],
        url: "https://evil.example",
      }),
    ).rejects.toThrow();
  });

  it("pages the inbox newest first with a keyset cursor", async () => {
    const ids: string[] = [];
    for (let n = 0; n < 23; n += 1) {
      ids.push(await notifyPerson(a, a.person.id));
    }
    const recipient = personRecipient(a.person.id);
    const first = await listInboxPage(a.companyId, recipient);
    const second = await listInboxPage(
      a.companyId,
      recipient,
      first.nextCursor,
    );

    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set([...first.items, ...second.items].map((item) => item.id)),
    ).toEqual(new Set(ids));
    expect(
      await listInboxPage(a.companyId, recipient, "garbage"),
    ).toMatchObject({ items: first.items });
  });
});

describe("company B and teammates never touch company A's messages", () => {
  it("writes no message for another company's person", async () => {
    await expect(
      createNotifications(b.companyId, {
        template: "receipt_available",
        data: SAMPLE_DATA.receipt_available,
        recipients: [personRecipient(a.person.id)],
      }),
    ).rejects.toThrow();
    expect(
      await ownerDb
        .select()
        .from(notifications)
        .where(eq(notifications.recipientPersonId, a.person.id)),
    ).toEqual([]);
  });

  it("notify writes and sends at once", async () => {
    const [id] = await notify(a.companyId, {
      template: "document_rejected",
      data: SAMPLE_DATA.document_rejected,
      recipients: [personRecipient(a.person.id)],
    });

    expect((await deliveryOf(id!, "email")).status).toBe("sent");
  });

  it("lib:notifications/listInboxPage", async () => {
    const id = await notifyPerson(a, a.person.id);

    expect(
      (await listInboxPage(b.companyId, personRecipient(a.person.id))).items,
    ).toEqual([]);
    expect(
      (await listInboxPage(a.companyId, personRecipient(a.teammate.id))).items,
    ).toEqual([]);
    expect(
      (
        await listInboxPage(a.companyId, personRecipient(a.person.id))
      ).items.map((item) => item.id),
    ).toEqual([id]);
  });

  it("lib:notifications/countUnread", async () => {
    await notifyPerson(a, a.person.id);

    expect(await countUnread(b.companyId, personRecipient(a.person.id))).toBe(
      0,
    );
    expect(await countUnread(a.companyId, personRecipient(a.teammate.id))).toBe(
      0,
    );
    expect(await countUnread(a.companyId, personRecipient(a.person.id))).toBe(
      1,
    );
  });

  it("lib:notifications/markNotificationRead", async () => {
    const id = await notifyPerson(a, a.person.id);

    expect(
      await markNotificationRead(b.companyId, personRecipient(a.person.id), id),
    ).toBeNull();
    expect(
      await markNotificationRead(
        a.companyId,
        personRecipient(a.teammate.id),
        id,
      ),
    ).toBeNull();
    expect((await notificationRow(id))!.readAt).toBeNull();
    expect(
      await markNotificationRead(a.companyId, personRecipient(a.person.id), id),
    ).toEqual({ url: "/mi" });
    expect((await notificationRow(id))!.readAt).not.toBeNull();
  });

  it("lib:notifications/markAllNotificationsRead", async () => {
    const id = await notifyPerson(a, a.person.id);

    expect(
      await markAllNotificationsRead(b.companyId, personRecipient(a.person.id)),
    ).toBe(0);
    expect(
      await markAllNotificationsRead(
        a.companyId,
        personRecipient(a.teammate.id),
      ),
    ).toBe(0);
    expect((await notificationRow(id))!.readAt).toBeNull();
  });

  it("lib:notifications/listOptOuts", async () => {
    await setChannelEnabled(
      a.companyId,
      personRecipient(a.person.id),
      "email",
      false,
    );

    expect([
      ...(await listOptOuts(b.companyId, personRecipient(a.person.id))),
    ]).toEqual([]);
    expect([
      ...(await listOptOuts(a.companyId, personRecipient(a.teammate.id))),
    ]).toEqual([]);
    expect([
      ...(await listOptOuts(a.companyId, personRecipient(a.person.id))),
    ]).toEqual(["email"]);
  });

  it("lib:notifications/setChannelEnabled", async () => {
    const id = await notifyPerson(a, a.person.id);

    // A person of A under company B is not a person of B: nothing is written.
    await expect(
      setChannelEnabled(
        b.companyId,
        personRecipient(a.person.id),
        "email",
        false,
      ),
    ).rejects.toThrow();
    // A teammate's opt-out does not skip someone else's delivery.
    await setChannelEnabled(
      a.companyId,
      personRecipient(a.teammate.id),
      "email",
      false,
    );

    expect((await deliveryOf(id, "email")).status).toBe("pending");
    expect(
      await ownerDb
        .select()
        .from(notificationOptOuts)
        .where(eq(notificationOptOuts.recipientPersonId, a.person.id)),
    ).toEqual([]);
  });

  it("lib:notifications/delivery/sendDueNotifications", async () => {
    const id = await notifyPerson(a, a.person.id);

    expect(await sendDueNotifications(b.companyId)).toEqual({
      sent: 0,
      skipped: 0,
      retry: 0,
    });
    expect((await deliveryOf(id, "email")).status).toBe("pending");
  });

  it("lib:notifications/delivery/sendNotificationsSoon", async () => {
    const id = await notifyPerson(a, a.person.id);

    await sendNotificationsSoon(b.companyId);
    expect((await deliveryOf(id, "email")).status).toBe("pending");

    // Outside a request it sends inline.
    await sendNotificationsSoon(a.companyId);
    expect((await deliveryOf(id, "email")).status).toBe("sent");
  });

  it("lib:notifications/delivery/pruneOldNotifications", async () => {
    const id = await notifyPerson(a, a.person.id);
    await ownerDb
      .update(notifications)
      .set({ createdAt: new Date("2024-01-01T00:00:00Z") })
      .where(eq(notifications.id, id));

    expect(await pruneOldNotifications(b.companyId)).toBe(0);
    expect(await notificationRow(id)).toBeDefined();
    expect(await pruneOldNotifications(a.companyId)).toBe(1);
    expect(await notificationRow(id)).toBeUndefined();
    expect(await deliveriesOf(id)).toEqual([]);
  });

  it("lib:notifications/push/savePushSubscription", async () => {
    await expect(
      savePushSubscription(b.companyId, a.person.id, subscription("x")),
    ).rejects.toThrow();
    expect(
      await ownerDb
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.personId, a.person.id)),
    ).toEqual([]);
  });

  it("lib:notifications/push/deletePushSubscription", async () => {
    const mine = subscription("a-mine");
    await savePushSubscription(a.companyId, a.person.id, mine);

    expect(
      await deletePushSubscription(b.companyId, a.person.id, mine.endpoint),
    ).toBe(false);
    expect(
      await deletePushSubscription(a.companyId, a.teammate.id, mine.endpoint),
    ).toBe(false);
    expect(
      await deletePushSubscription(a.companyId, a.person.id, mine.endpoint),
    ).toBe(true);
  });

  it("lib:notifications/push/sendPushToPerson", async () => {
    await savePushSubscription(a.companyId, a.person.id, subscription("a3"));

    expect(
      await sendPushToPerson(b.companyId, a.person.id, {
        title: "t",
        body: "b",
        url: "/mi",
        tag: "x",
      }),
    ).toEqual({ status: "skipped", reason: "no_device" });
    expect(pushCalls).toEqual([]);
  });

  it("lib:notifications/recipients/hrRecipientsWithPermission", async () => {
    const recipients = await hrRecipientsWithPermission(
      b.companyId,
      "contracts:update",
    );
    const ids = recipients.map((r) => (r.kind === "user" ? r.userId : ""));

    expect(ids).toContain(b.admin.id);
    expect(ids).not.toContain(a.admin.id);
    expect(ids).not.toContain(b.viewer.id);
  });

  it("lib:notifications/recipients/managerRecipientOf", async () => {
    expect(await managerRecipientOf(b.companyId, a.teammate.id)).toBeNull();
    expect(await managerRecipientOf(a.companyId, a.teammate.id)).toEqual(
      personRecipient(a.person.id),
    );
  });
});

describe("employee app actions use the session's person", () => {
  it("action:notifications/openEmployeeNotificationAction", async () => {
    const id = await notifyPerson(a, a.person.id);

    actAsEmployee(b, "person");
    expect(
      await redirectOf(() => openEmployeeNotificationAction(formData({ id }))),
    ).toBe("/mi/avisos");
    actAsEmployee(a, "teammate");
    expect(
      await redirectOf(() => openEmployeeNotificationAction(formData({ id }))),
    ).toBe("/mi/avisos");
    expect((await notificationRow(id))!.readAt).toBeNull();

    actAsEmployee(a, "person");
    expect(
      await redirectOf(() => openEmployeeNotificationAction(formData({ id }))),
    ).toBe("/mi");
    expect((await notificationRow(id))!.readAt).not.toBeNull();
  });

  it("action:notifications/markAllEmployeeNotificationsReadAction", async () => {
    const id = await notifyPerson(a, a.person.id);

    actAsEmployee(a, "teammate");
    await markAllEmployeeNotificationsReadAction();
    actAsEmployee(b, "person");
    await markAllEmployeeNotificationsReadAction();

    expect((await notificationRow(id))!.readAt).toBeNull();
  });

  it("action:notifications/setEmployeeChannelAction", async () => {
    actAsEmployee(a, "teammate");
    await setEmployeeChannelAction(
      formData({ channel: "email", enabled: "0" }),
    );
    await setEmployeeChannelAction(formData({ channel: "sms", enabled: "0" }));

    expect([
      ...(await listOptOuts(a.companyId, personRecipient(a.person.id))),
    ]).toEqual([]);
    expect([
      ...(await listOptOuts(a.companyId, personRecipient(a.teammate.id))),
    ]).toEqual(["email"]);
  });
});

describe("HR app actions use the signed-in user in their company", () => {
  const notifyAdminA = async () => {
    const [id] = await createNotifications(a.companyId, {
      template: "contract_ending",
      data: SAMPLE_DATA.contract_ending,
      recipients: [userRecipient(a.admin.id)],
    });
    return id!;
  };

  it("action:notifications/openUserNotificationAction", async () => {
    const id = await notifyAdminA();

    actAs(b.admin, b.companyId);
    expect(
      await redirectOf(() => openUserNotificationAction(formData({ id }))),
    ).toBe("/app/avisos");
    actAs(a.viewer, a.companyId);
    expect(
      await redirectOf(() => openUserNotificationAction(formData({ id }))),
    ).toBe("/app/avisos");
    expect((await notificationRow(id))!.readAt).toBeNull();
  });

  it("action:notifications/markAllUserNotificationsReadAction", async () => {
    const id = await notifyAdminA();

    actAs(b.admin, b.companyId);
    await markAllUserNotificationsReadAction();

    expect((await notificationRow(id))!.readAt).toBeNull();
  });

  it("action:notifications/setUserEmailChannelAction", async () => {
    actAs(b.admin, b.companyId);
    await setUserEmailChannelAction(formData({ enabled: "0" }));

    expect([
      ...(await listOptOuts(a.companyId, userRecipient(b.admin.id))),
    ]).toEqual([]);
    expect([
      ...(await listOptOuts(a.companyId, userRecipient(a.admin.id))),
    ]).toEqual([]);
    expect([
      ...(await listOptOuts(b.companyId, userRecipient(b.admin.id))),
    ]).toEqual(["email"]);
  });
});

describe("routes", () => {
  it("route:POST /api/mi/push", async () => {
    expect(
      (await postPushRoute(pushRequest("POST", subscription("n")))).status,
    ).toBe(401);

    actAsEmployee(b, "person");
    expect(
      (await postPushRoute(pushRequest("POST", { endpoint: "nope" }))).status,
    ).toBe(400);
    expect(
      (await postPushRoute(pushRequest("POST", subscription("b1")))).status,
    ).toBe(200);

    const rows = await ownerDb
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, subscription("b1").endpoint));
    expect(rows.map((row) => [row.companyId, row.personId])).toEqual([
      [b.companyId, b.person.id],
    ]);
  });

  it("route:DELETE /api/mi/push", async () => {
    await savePushSubscription(a.companyId, a.person.id, subscription("a9"));

    actAsEmployee(b, "person");
    expect(
      (
        await deletePushRoute(
          pushRequest("DELETE", { endpoint: subscription("a9").endpoint }),
        )
      ).status,
    ).toBe(200);
    expect(
      await ownerDb
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.companyId, a.companyId)),
    ).toHaveLength(1);
  });

  it("route:GET /api/cron/notifications", async () => {
    const idA = await notifyPerson(a, a.person.id);
    const idB = await notifyPerson(b, b.person.id);
    const request = (authorization?: string) =>
      new NextRequest("https://workia.test/api/cron/notifications", {
        headers: authorization ? { authorization } : {},
      });

    expect((await cronSweep(request())).status).toBe(401);
    expect((await cronSweep(request("Bearer wrong"))).status).toBe(401);
    expect((await deliveryOf(idA, "email")).status).toBe("pending");

    const response = await cronSweep(
      request(`Bearer ${process.env.CRON_SECRET}`),
    );
    expect(response.status).toBe(200);
    expect((await deliveryOf(idA, "email")).status).toBe("sent");
    expect((await deliveryOf(idB, "email")).status).toBe("sent");
    expect(jar.sent.map((sent) => sent.to).sort()).toEqual(
      [emailOf(a, "ana"), emailOf(b, "beto")].sort(),
    );
  });
});
