"use server";

import { getEmployeeContext } from "@/lib/employee-accounts/session";
import { hitRateLimit } from "@/lib/mcp/rate-limit";

import { checkIn, type CheckinResult } from "./checkin";

export type CheckinRequest = {
  siteId: string;
  window: string;
  mac: string;
  kind: "in" | "out";
  latitude: number;
  longitude: number;
  accuracy: number;
};

/**
 * The employee app's check-in (W2-12). The person is the session's, never the
 * request's; the site comes from the signed QR code.
 */
export const checkInAction = async (
  request: CheckinRequest,
): Promise<CheckinResult> => {
  const context = await getEmployeeContext();

  if (!context) {
    return { ok: false, error: "Tu sesión terminó. Vuelve a entrar." };
  }

  const limit = await hitRateLimit(
    `attendance-checkin:${context.accountId}`,
    10,
    60_000,
  );

  if (limit.limited) {
    return { ok: false, error: "Demasiados intentos. Espera un minuto." };
  }

  if (request.kind !== "in" && request.kind !== "out") {
    return { ok: false, error: "Elige entrada o salida." };
  }

  return checkIn(context, {
    code: {
      siteId: String(request.siteId ?? ""),
      window: String(request.window ?? ""),
      mac: String(request.mac ?? ""),
    },
    kind: request.kind,
    latitude: Number(request.latitude),
    longitude: Number(request.longitude),
    accuracy: Number(request.accuracy),
  });
};
