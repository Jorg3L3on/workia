import { NextResponse, type NextRequest } from "next/server";

import { getEmployeeContext } from "@/lib/employee-accounts/session";
import { personRecipient, setChannelEnabled } from "@/lib/notifications";
import {
  deletePushSubscription,
  parseBrowserSubscription,
  pushConfigured,
  savePushSubscription,
} from "@/lib/notifications/push";

/**
 * Web push devices of the signed-in employee (W2-08). The browser posts its
 * PushManager subscription here; the person comes from the session cookie,
 * never from the body.
 */
const readJson = async (request: NextRequest) => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

export const POST = async (request: NextRequest) => {
  const context = await getEmployeeContext();

  if (!context) {
    return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  }

  if (!pushConfigured()) {
    return NextResponse.json(
      { error: "Las notificaciones push no están activas" },
      { status: 404 },
    );
  }

  const subscription = parseBrowserSubscription(await readJson(request));

  if (!subscription) {
    return NextResponse.json(
      { error: "Suscripción no válida" },
      { status: 400 },
    );
  }

  await savePushSubscription(
    context.companyId,
    context.personId,
    subscription,
    request.headers.get("user-agent"),
  );
  // Turning a phone on means the person wants push again.
  await setChannelEnabled(
    context.companyId,
    personRecipient(context.personId),
    "push",
    true,
  );

  return NextResponse.json({ ok: true });
};

export const DELETE = async (request: NextRequest) => {
  const context = await getEmployeeContext();

  if (!context) {
    return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
  }

  const body = (await readJson(request)) as { endpoint?: unknown } | null;

  if (typeof body?.endpoint !== "string") {
    return NextResponse.json({ error: "Falta el endpoint" }, { status: 400 });
  }

  await deletePushSubscription(
    context.companyId,
    context.personId,
    body.endpoint,
  );

  return NextResponse.json({ ok: true });
};
