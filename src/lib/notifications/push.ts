import { and, eq } from "drizzle-orm";

import { env } from "@/env";
import { tdb } from "@/lib/db";
import { pushSubscriptions } from "@/lib/db/schema";

import type { DeliveryOutcome } from "./policy";
import type { BrowserSubscription } from "./push-subscription";

export * from "./push-subscription";

/**
 * Web push (W2-08) with VAPID: free, no account with any provider. The
 * browser's push service (Google, Mozilla, Apple) carries the message to the
 * phone. Keys come from `npm run push:vapid-keys`; without them push is off.
 */
export const pushConfigured = () =>
  Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);

/** The key the browser needs to subscribe, or null when push is off. */
export const pushPublicKey = () =>
  pushConfigured() ? env.VAPID_PUBLIC_KEY! : null;

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  /** Replaces an earlier notice with the same tag on the phone. */
  tag: string;
};

/** Saves (or refreshes) a device of the signed-in person. */
export const savePushSubscription = async (
  companyId: string,
  personId: string,
  subscription: BrowserSubscription,
  userAgent?: string | null,
) => {
  await tdb(companyId)
    .insert(pushSubscriptions)
    .values({
      companyId,
      personId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userAgent: userAgent?.slice(0, 300) ?? null,
    })
    .onConflictDoUpdate({
      target: [pushSubscriptions.companyId, pushSubscriptions.endpoint],
      set: {
        personId,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent: userAgent?.slice(0, 300) ?? null,
      },
    });
};

/** Forgets a device of the signed-in person. Another person's endpoint is untouched. */
export const deletePushSubscription = async (
  companyId: string,
  personId: string,
  endpoint: string,
) => {
  const rows = await tdb(companyId)
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.companyId, companyId),
        eq(pushSubscriptions.personId, personId),
        eq(pushSubscriptions.endpoint, endpoint),
      ),
    )
    .returning({ id: pushSubscriptions.id });

  return rows.length > 0;
};

type WebPush = typeof import("web-push");

let webPush: WebPush | undefined;

const loadWebPush = async () => {
  if (!webPush) {
    const loaded = await import("web-push");
    webPush = (loaded as unknown as { default?: WebPush }).default ?? loaded;
    webPush.setVapidDetails(
      env.VAPID_SUBJECT!,
      env.VAPID_PUBLIC_KEY!,
      env.VAPID_PRIVATE_KEY!,
    );
  }

  return webPush;
};

/** Test seam: replace the sender (the real one talks to the push services). */
export const pushSender = {
  send: async (subscription: BrowserSubscription, payload: string) => {
    const client = await loadWebPush();
    await client.sendNotification(subscription, payload, {
      TTL: 24 * 60 * 60,
      urgency: "normal",
    });
  },
};

const statusCodeOf = (error: unknown) =>
  typeof error === "object" && error && "statusCode" in error
    ? Number((error as { statusCode: unknown }).statusCode)
    : null;

/**
 * Sends one message to every device of the person. Sent when one device took
 * it; a device the push service no longer knows (404, 410) is deleted; any
 * other failure retries the whole delivery later.
 */
export const sendPushToPerson = async (
  companyId: string,
  personId: string,
  payload: PushPayload,
): Promise<DeliveryOutcome> => {
  if (!pushConfigured()) {
    return { status: "skipped", reason: "not_configured" };
  }

  const devices = await tdb(companyId)
    .select()
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.companyId, companyId),
        eq(pushSubscriptions.personId, personId),
      ),
    );

  if (devices.length === 0) {
    return { status: "skipped", reason: "no_device" };
  }

  const body = JSON.stringify(payload);
  let delivered = 0;
  let lastError: string | null = null;

  for (const device of devices) {
    try {
      await pushSender.send(
        {
          endpoint: device.endpoint,
          keys: { p256dh: device.p256dh, auth: device.auth },
        },
        body,
      );
      delivered += 1;
      await tdb(companyId)
        .update(pushSubscriptions)
        .set({ lastSuccessAt: new Date() })
        .where(
          and(
            eq(pushSubscriptions.companyId, companyId),
            eq(pushSubscriptions.id, device.id),
          ),
        );
    } catch (error) {
      const status = statusCodeOf(error);

      if (status === 404 || status === 410) {
        await tdb(companyId)
          .delete(pushSubscriptions)
          .where(
            and(
              eq(pushSubscriptions.companyId, companyId),
              eq(pushSubscriptions.id, device.id),
            ),
          );
        continue;
      }

      lastError = `push ${status ?? "error"}: ${
        error instanceof Error ? error.message : String(error)
      }`.slice(0, 500);
    }
  }

  if (delivered > 0) {
    return { status: "sent" };
  }

  return lastError
    ? { status: "retry", error: lastError }
    : { status: "skipped", reason: "no_device" };
};
