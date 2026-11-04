import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed QR codes for app check-in (W2-12) and the distance check. Pure
 * functions: the secret is per site (attendance_checkin_sites.qr_secret).
 */

/** Rotating codes change every minute; one scanned up to three minutes ago still works. */
export const QR_WINDOW_MS = 60_000;
const QR_WINDOWS_ACCEPTED = 3;

const mac = (secret: string, siteId: string, window: string) =>
  createHmac("sha256", secret)
    .update(`${siteId}.${window}`)
    .digest("base64url")
    .slice(0, 22);

const sameMac = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);

  return x.length === y.length && timingSafeEqual(x, y);
};

export type QrCode = { siteId: string; window: string; mac: string };

/** The code a site shows now: the current minute, or "p" for a printed code. */
export const qrCodeFor = (
  site: { siteId: string; qrSecret: string; qrMode: "rotating" | "printed" },
  now = new Date(),
): QrCode => {
  const window =
    site.qrMode === "printed"
      ? "p"
      : String(Math.floor(now.getTime() / QR_WINDOW_MS));

  return {
    siteId: site.siteId,
    window,
    mac: mac(site.qrSecret, site.siteId, window),
  };
};

/** The URL the QR encodes: /mi/checar with the code in the query. */
export const qrCodeUrl = (origin: string, code: QrCode) => {
  const url = new URL("/mi/checar", origin);

  url.searchParams.set("s", code.siteId);
  url.searchParams.set("w", code.window);
  url.searchParams.set("m", code.mac);

  return url.toString();
};

export type QrCheck = "ok" | "invalid" | "expired";

export const verifyQrCode = (
  site: { siteId: string; qrSecret: string; qrMode: "rotating" | "printed" },
  code: QrCode,
  now = new Date(),
): QrCheck => {
  if (code.siteId !== site.siteId || !/^[A-Za-z0-9_-]{22}$/.test(code.mac)) {
    return "invalid";
  }

  if (!sameMac(mac(site.qrSecret, site.siteId, code.window), code.mac)) {
    return "invalid";
  }

  if (code.window === "p") {
    return site.qrMode === "printed" ? "ok" : "expired";
  }

  if (!/^\d{1,12}$/.test(code.window)) return "invalid";

  const age = Math.floor(now.getTime() / QR_WINDOW_MS) - Number(code.window);

  return age >= 0 && age < QR_WINDOWS_ACCEPTED ? "ok" : "expired";
};

/** Great-circle distance in meters. */
export const distanceMeters = (
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) => {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(dLon / 2) ** 2;

  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
};
