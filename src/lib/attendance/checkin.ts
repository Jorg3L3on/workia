import { and, eq } from "drizzle-orm";

import { tdb } from "@/lib/db";
import { attendanceCheckinSites, personEvents, sites } from "@/lib/db/schema";
import { pendingPrivacyNotice } from "@/lib/privacy";
import type { EmployeeContext } from "@/lib/employee-accounts/sign-in";
import { withTenant } from "@/lib/tenant/scope";
import { attendanceDedupeKey } from "@/lib/timeline";
import { readAttendance } from "@/lib/timeline/writers";

import { ingestPunches } from "./ingest";
import { distanceMeters, verifyQrCode, type QrCode } from "./qr";
import { localDay, localTime } from "./time";

export {
  distanceMeters,
  qrCodeFor,
  qrCodeUrl,
  QR_WINDOW_MS,
  verifyQrCode,
  type QrCode,
} from "./qr";

/**
 * App check-in (W2-12): the employee scans the site's QR with the phone
 * camera, which opens /mi/checar with a signed code, and the phone sends its
 * location. The punch counts when the code is genuine and the phone is inside
 * the site's radius. Only the punch is stored (time, kind, "app" and the
 * site); the coordinates are used to decide and then dropped.
 */

/** A fix worse than this cannot tell inside from outside a site. */
export const MAX_ACCURACY_METERS = 150;

/** Two taps on the same button within this time are one punch. */
const REPEAT_WINDOW_MS = 2 * 60_000;

export const CHECKIN_COPY = {
  invalidCode:
    "Este código QR no es válido. Escanea el que está en tu sucursal.",
  expiredCode: "El código QR ya cambió. Escanéalo de nuevo.",
  disabled: "El checado en la app no está activo en esta sucursal.",
  location:
    "No pudimos leer tu ubicación. Activa la ubicación y vuelve a intentarlo.",
  accuracy:
    "Tu ubicación es muy imprecisa. Sal a un lugar abierto o activa el GPS y vuelve a intentarlo.",
  outside: (meters: number) =>
    `Estás a ${meters.toLocaleString("es-MX")} m de la sucursal. Acércate para checar.`,
  privacy:
    "Antes de checar en la app necesitas aceptar el aviso de privacidad. Pide a RH que lo registre.",
  repeated: "Ya registramos esta checada hace un momento.",
  done: (kind: "in" | "out", time: string) =>
    `${kind === "in" ? "Entrada" : "Salida"} registrada a las ${time}.`,
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The check-in point of a site of the employee's company, or null. */
export const checkinSiteFor = async (companyId: string, siteId: string) => {
  if (!UUID.test(siteId)) return null;

  const [row] = await tdb(companyId)
    .select({
      siteId: attendanceCheckinSites.siteId,
      siteName: sites.name,
      latitude: attendanceCheckinSites.latitude,
      longitude: attendanceCheckinSites.longitude,
      radiusMeters: attendanceCheckinSites.radiusMeters,
      qrMode: attendanceCheckinSites.qrMode,
      qrSecret: attendanceCheckinSites.qrSecret,
      enabled: attendanceCheckinSites.enabled,
    })
    .from(attendanceCheckinSites)
    .innerJoin(
      sites,
      and(
        eq(sites.companyId, attendanceCheckinSites.companyId),
        eq(sites.id, attendanceCheckinSites.siteId),
      ),
    )
    .where(
      withTenant(
        attendanceCheckinSites,
        companyId,
        eq(attendanceCheckinSites.siteId, siteId),
      ),
    )
    .limit(1);

  return row ?? null;
};

export type CheckinInput = {
  code: QrCode;
  kind: "in" | "out";
  latitude: number;
  longitude: number;
  accuracy: number;
};

export type CheckinResult =
  { ok: true; message: string } | { ok: false; error: string };

/**
 * Records an app punch for the signed-in employee. The person comes from the
 * session; the site, from the signed code; nothing else from the request.
 */
export const checkIn = async (
  context: EmployeeContext,
  input: CheckinInput,
  now = new Date(),
): Promise<CheckinResult> => {
  const site = await checkinSiteFor(context.companyId, input.code.siteId);

  if (!site) return { ok: false, error: CHECKIN_COPY.invalidCode };

  const check = verifyQrCode(site, input.code, now);

  if (check === "invalid")
    return { ok: false, error: CHECKIN_COPY.invalidCode };
  if (check === "expired")
    return { ok: false, error: CHECKIN_COPY.expiredCode };
  if (!site.enabled) return { ok: false, error: CHECKIN_COPY.disabled };

  if (await pendingPrivacyNotice(context.companyId, context.personId)) {
    return { ok: false, error: CHECKIN_COPY.privacy };
  }

  const valid =
    Number.isFinite(input.latitude) &&
    Number.isFinite(input.longitude) &&
    Number.isFinite(input.accuracy) &&
    Math.abs(input.latitude) <= 90 &&
    Math.abs(input.longitude) <= 180 &&
    input.accuracy >= 0;

  if (!valid) return { ok: false, error: CHECKIN_COPY.location };
  if (input.accuracy > MAX_ACCURACY_METERS)
    return { ok: false, error: CHECKIN_COPY.accuracy };

  const distance = distanceMeters(site, input);

  if (distance > site.radiusMeters) {
    return { ok: false, error: CHECKIN_COPY.outside(Math.round(distance)) };
  }

  // A second tap right after the first is the same punch.
  const [today] = await tdb(context.companyId)
    .select({ payload: personEvents.payload })
    .from(personEvents)
    .where(
      withTenant(
        personEvents,
        context.companyId,
        eq(personEvents.personId, context.personId),
        eq(personEvents.dedupeKey, attendanceDedupeKey(localDay(now))),
      ),
    )
    .limit(1);
  const recent = today
    ? readAttendance(today.payload).punches.some(
        (punch) =>
          punch.device_id === "app" &&
          punch.kind === input.kind &&
          now.getTime() - new Date(punch.at).getTime() < REPEAT_WINDOW_MS,
      )
    : false;

  if (recent) return { ok: false, error: CHECKIN_COPY.repeated };

  await ingestPunches(
    context.companyId,
    { kind: "app", siteId: site.siteId },
    [
      {
        line: 1,
        raw: [],
        badge: null,
        personId: context.personId,
        at: now,
        kind: input.kind,
      },
    ],
    [],
    { now },
  );

  return { ok: true, message: CHECKIN_COPY.done(input.kind, localTime(now)) };
};
