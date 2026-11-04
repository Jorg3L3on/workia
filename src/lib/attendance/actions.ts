"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { z } from "zod";

import { requestOrigin } from "@/lib/employee-accounts/session";
import { searchPeopleForPrivacy } from "@/lib/privacy";
import { AuthorizationError } from "@/lib/rbac/errors";
import {
  STALE_COMPANY_MESSAGE,
  writableCompanyIdFromForm,
} from "@/lib/tenant/scope";

import { requireAttendanceManage } from "./auth";
import { checkinSiteFor, qrCodeFor, qrCodeUrl, QR_WINDOW_MS } from "./checkin";
import { csvFormatSchema } from "./csv-format";
import {
  assignBadge,
  ATTENDANCE_COPY,
  createAttendanceDevice,
  dismissUnmatched,
  importChecadorCsv,
  issueDeviceToken,
  MAX_CSV_BYTES,
  removeBadge,
  rotateCheckinSecret,
  saveCheckinSite,
  setAttendanceDeviceActive,
  updateAttendanceDevice,
} from "./index";
import type { IngestSummary } from "./ingest";

export type AttendanceActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
  /** A device token, shown once. */
  token?: string;
  summary?: IngestSummary;
};

const ATTENDANCE_PATH = "/app/asistencia";

const revalidate = () => {
  revalidatePath(ATTENDANCE_PATH);
  revalidatePath("/app/auditoria");
};

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
};

const manageContext = async (formData: FormData) => {
  let session: Awaited<ReturnType<typeof requireAttendanceManage>>;

  try {
    session = await requireAttendanceManage();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { error: ATTENDANCE_COPY.denied } as const;
    }

    redirect("/login");
  }

  try {
    return {
      userId: session.user.id,
      companyId: writableCompanyIdFromForm(session, formData),
    } as const;
  } catch {
    return { error: STALE_COMPANY_MESSAGE } as const;
  }
};

const UUID = z.string().uuid();
const optionalUuid = z
  .string()
  .transform((value) => (value === "" ? null : value))
  .pipe(z.string().uuid().nullable());

const list = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const deviceSchema = z.object({
  name: z.string().trim().min(1, ATTENDANCE_COPY.deviceName).max(80, ATTENDANCE_COPY.deviceName),
  siteId: optionalUuid,
  csvFormat: csvFormatSchema,
});

const readDevice = (formData: FormData) =>
  deviceSchema.safeParse({
    name: text(formData, "name"),
    siteId: text(formData, "siteId"),
    csvFormat: {
      delimiter: text(formData, "delimiter") === "tab" ? "\t" : text(formData, "delimiter") || "auto",
      headerRows: text(formData, "headerRows") || "0",
      badgeColumn: text(formData, "badgeColumn"),
      dateTimeColumn: text(formData, "dateTimeColumn"),
      dateColumn: text(formData, "dateColumn"),
      timeColumn: text(formData, "timeColumn"),
      dateFormat: text(formData, "dateFormat"),
      kindColumn: text(formData, "kindColumn"),
      inValues: list(text(formData, "inValues")),
      outValues: list(text(formData, "outValues")),
    },
  });

const firstIssue = (error: z.ZodError, fallback: string) =>
  error.issues[0]?.message ?? fallback;

/** Formats without empty optional fields, so stored JSON stays small. */
const compactFormat = (format: z.infer<typeof csvFormatSchema>) =>
  Object.fromEntries(
    Object.entries(format).filter(
      ([, value]) => value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0),
    ),
  ) as z.infer<typeof csvFormatSchema>;

export const saveAttendanceDeviceAction = async (
  _state: AttendanceActionState,
  formData: FormData,
): Promise<AttendanceActionState> => {
  const context = await manageContext(formData);

  if ("error" in context) return { error: context.error };

  const parsed = readDevice(formData);

  if (!parsed.success) return { error: firstIssue(parsed.error, ATTENDANCE_COPY.deviceName) };

  const input = { ...parsed.data, csvFormat: compactFormat(parsed.data.csvFormat) };
  const deviceId = text(formData, "deviceId");
  const result = deviceId
    ? UUID.safeParse(deviceId).success
      ? await updateAttendanceDevice(context.companyId, deviceId, input, context.userId)
      : { ok: false as const, error: ATTENDANCE_COPY.deviceMissing }
    : await createAttendanceDevice(context.companyId, input, context.userId);

  if (!result.ok) return { error: result.error };

  revalidate();
  return { ok: true, message: deviceId ? "Checador actualizado." : "Checador agregado." };
};

export const issueDeviceTokenAction = async (
  _state: AttendanceActionState,
  formData: FormData,
): Promise<AttendanceActionState> => {
  const context = await manageContext(formData);

  if ("error" in context) return { error: context.error };

  const deviceId = text(formData, "deviceId");

  if (!UUID.safeParse(deviceId).success) return { error: ATTENDANCE_COPY.deviceMissing };

  const result = await issueDeviceToken(context.companyId, deviceId, context.userId);

  if (!result.ok) return { error: result.error };

  revalidate();
  return {
    ok: true,
    token: result.token,
    message: "Copia el token ahora: no se vuelve a mostrar. El anterior dejó de funcionar.",
  };
};

export const setAttendanceDeviceActiveAction = async (
  _state: AttendanceActionState,
  formData: FormData,
): Promise<AttendanceActionState> => {
  const context = await manageContext(formData);

  if ("error" in context) return { error: context.error };

  const deviceId = text(formData, "deviceId");

  if (!UUID.safeParse(deviceId).success) return { error: ATTENDANCE_COPY.deviceMissing };

  const active = text(formData, "active") === "true";
  const result = await setAttendanceDeviceActive(context.companyId, deviceId, active, context.userId);

  if (!result.ok) return { error: result.error };

  revalidate();
  return { ok: true, message: active ? "Checador activado." : "Checador desactivado; su token ya no funciona." };
};

export const importChecadorCsvAction = async (
  _state: AttendanceActionState,
  formData: FormData,
): Promise<AttendanceActionState> => {
  const context = await manageContext(formData);

  if ("error" in context) return { error: context.error };

  const deviceId = text(formData, "deviceId");
  const file = formData.get("file");

  if (!UUID.safeParse(deviceId).success) return { error: ATTENDANCE_COPY.deviceMissing };
  if (!(file instanceof File) || file.size === 0) return { error: ATTENDANCE_COPY.fileMissing };
  if (file.size > MAX_CSV_BYTES) return { error: ATTENDANCE_COPY.fileTooLarge };

  const bytes = new Uint8Array(await file.arrayBuffer());
  // Checador software often writes Latin-1; fall back to it when UTF-8 fails.
  let content: string;

  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    content = new TextDecoder("latin1").decode(bytes);
  }

  const result = await importChecadorCsv(
    context.companyId,
    { deviceId, fileName: file.name || "checadas.csv", text: content },
    context.userId,
  );

  if (!result.ok) return { error: result.error };

  revalidate();
  return { ok: true, summary: result.summary };
};

export const assignBadgeAction = async (
  _state: AttendanceActionState,
  formData: FormData,
): Promise<AttendanceActionState> => {
  const context = await manageContext(formData);

  if ("error" in context) return { error: context.error };

  const personId = text(formData, "personId");

  if (!UUID.safeParse(personId).success) return { error: "Elige a la persona." };

  const result = await assignBadge(
    context.companyId,
    { badge: text(formData, "badge"), personId },
    context.userId,
  );

  if (!result.ok) return { error: result.error };

  revalidate();
  return {
    ok: true,
    message:
      result.placed > 0
        ? `Número asignado; ${result.placed} ${result.placed === 1 ? "checada pendiente quedó registrada" : "checadas pendientes quedaron registradas"}.`
        : "Número asignado.",
  };
};

export const removeBadgeAction = async (
  _state: AttendanceActionState,
  formData: FormData,
): Promise<AttendanceActionState> => {
  const context = await manageContext(formData);

  if ("error" in context) return { error: context.error };

  const badgeId = text(formData, "badgeId");

  if (!UUID.safeParse(badgeId).success) return { error: ATTENDANCE_COPY.badge };

  const result = await removeBadge(context.companyId, badgeId, context.userId);

  if (!result.ok) return { error: result.error };

  revalidate();
  return { ok: true, message: "Número quitado." };
};

export const dismissUnmatchedAction = async (
  _state: AttendanceActionState,
  formData: FormData,
): Promise<AttendanceActionState> => {
  const context = await manageContext(formData);

  if ("error" in context) return { error: context.error };

  const id = text(formData, "unmatchedId");

  if (!UUID.safeParse(id).success) return { error: ATTENDANCE_COPY.rowMissing };

  const result = await dismissUnmatched(context.companyId, id, context.userId);

  if (!result.ok) return { error: result.error };

  revalidate();
  return { ok: true, message: "Checada descartada." };
};

const checkinSchema = z.object({
  siteId: UUID,
  latitude: z.coerce.number().min(-90, ATTENDANCE_COPY.position).max(90, ATTENDANCE_COPY.position),
  longitude: z.coerce.number().min(-180, ATTENDANCE_COPY.position).max(180, ATTENDANCE_COPY.position),
  radiusMeters: z.coerce.number().int(ATTENDANCE_COPY.radius).min(25, ATTENDANCE_COPY.radius).max(2000, ATTENDANCE_COPY.radius),
  qrMode: z.enum(["rotating", "printed"]),
  enabled: z.boolean(),
});

export const saveCheckinSiteAction = async (
  _state: AttendanceActionState,
  formData: FormData,
): Promise<AttendanceActionState> => {
  const context = await manageContext(formData);

  if ("error" in context) return { error: context.error };

  const latitude = text(formData, "latitude");
  const longitude = text(formData, "longitude");

  if (!latitude || !longitude) return { error: ATTENDANCE_COPY.position };

  const parsed = checkinSchema.safeParse({
    siteId: text(formData, "siteId"),
    latitude,
    longitude,
    radiusMeters: text(formData, "radiusMeters") || "150",
    qrMode: text(formData, "qrMode") || "rotating",
    enabled: text(formData, "enabled") !== "false",
  });

  if (!parsed.success) return { error: firstIssue(parsed.error, ATTENDANCE_COPY.position) };

  const result = await saveCheckinSite(context.companyId, parsed.data, context.userId);

  if (!result.ok) return { error: result.error };

  revalidate();
  return { ok: true, message: "Checado en la app guardado." };
};

export const rotateCheckinSecretAction = async (
  _state: AttendanceActionState,
  formData: FormData,
): Promise<AttendanceActionState> => {
  const context = await manageContext(formData);

  if ("error" in context) return { error: context.error };

  const siteId = text(formData, "siteId");

  if (!UUID.safeParse(siteId).success) return { error: ATTENDANCE_COPY.siteMissing };

  const result = await rotateCheckinSecret(context.companyId, siteId, context.userId);

  if (!result.ok) return { error: result.error };

  revalidate();
  return { ok: true, message: "Códigos QR anteriores invalidados. Imprime o muestra el nuevo." };
};

export type KioskCode = { svg: string; url: string; refreshInMs: number | null } | null;

/**
 * The QR a site shows right now, for the kiosk page (HR session on a screen
 * at the site). Rotating codes come back with when to ask again.
 */
export const kioskCodeAction = async (siteId: string): Promise<KioskCode> => {
  let session: Awaited<ReturnType<typeof requireAttendanceManage>>;

  try {
    session = await requireAttendanceManage();
  } catch {
    return null;
  }

  if (!UUID.safeParse(siteId).success) return null;

  const site = await checkinSiteFor(session.companyId, siteId);

  if (!site || !site.enabled) return null;

  const now = new Date();
  const url = qrCodeUrl(await requestOrigin(), qrCodeFor(site, now));
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });

  return {
    svg,
    url,
    refreshInMs:
      site.qrMode === "rotating" ? QR_WINDOW_MS - (now.getTime() % QR_WINDOW_MS) + 250 : null,
  };
};

/** Person search for the number form; people on baja included (old punches). */
export const searchAttendancePeopleAction = async (query: string) => {
  try {
    const session = await requireAttendanceManage();

    return await searchPeopleForPrivacy(session.companyId, query);
  } catch {
    return [];
  }
};
