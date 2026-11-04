import type { TimeOffKind, TimeOffStatus } from "@/lib/db/schema/requests";
import { formatStoredDays, toHalfUnits } from "@/lib/vacations/balance";

/**
 * The pure rules of requests and approvals (Workia 2.0 W2-06,
 * docs/solicitudes.md): what a request may say, how its days relate to the
 * person's schedule, and which transitions are allowed. No clock and no
 * database: callers pass `today` (the Mexico date) and the rows.
 */

export const TIME_OFF_KINDS = [
  "vacaciones",
  "permiso_con_goce",
  "permiso_sin_goce",
] as const satisfies readonly TimeOffKind[];

export const TIME_OFF_KIND_LABELS: Record<TimeOffKind, string> = {
  vacaciones: "Vacaciones",
  permiso_con_goce: "Permiso con goce de sueldo",
  permiso_sin_goce: "Permiso sin goce de sueldo",
};

export const TIME_OFF_STATUS_LABELS: Record<TimeOffStatus, string> = {
  pending: "Pendiente",
  approved: "Aprobada",
  rejected: "Rechazada",
  cancelled: "Cancelada",
};

export const REQUEST_COPY = {
  kind: "Elige qué quieres pedir.",
  startDate: "Indica el primer día.",
  endDate: "Indica el último día.",
  endBeforeStart: "El último día no puede ser antes del primero.",
  past: "Las solicitudes son para hoy o días futuros.",
  tooLong: "Una solicitud cubre hasta 90 días. Divide el periodo en varias.",
  days: "Indica los días en medios días, mayores a 0 (por ejemplo 1 o 0.5).",
  daysOverRange: "Pides más días de los que tiene el periodo.",
  note: "La nota puede tener hasta 280 caracteres.",
  overlap: "Ya tienes una solicitud o vacaciones en esas fechas.",
  overBalance:
    "Pides más días de vacaciones de los que te quedan en ese año de servicio.",
  noServiceYear:
    "Todavía no se puede ubicar ese periodo en un año de servicio. Pregunta a RH.",
  notActive: "Tu expediente no está activo. Pregunta a RH.",
  notFound: "No encontramos esa solicitud.",
  notPending: "Esa solicitud ya no está pendiente.",
  cannotCancel:
    "Solo puedes cancelar una solicitud pendiente, o una aprobada antes de su primer día.",
  reasonRequired: "Escribe el motivo del rechazo.",
  reason: "El motivo puede tener hasta 280 caracteres.",
  decision: "Elige aprobar o rechazar.",
  ownRequest: "No puedes decidir tu propia solicitud.",
  deniedDecide: "No tienes permiso para decidir solicitudes.",
  vacationFailed:
    "No se pudo registrar el periodo de vacaciones. Revisa las fechas con RH.",
} as const;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const MAX_RANGE_DAYS = 90;
const TEXT_LIMIT = 280;

export const isIsoDate = (value: string) => {
  const match = ISO_DATE.exec(value);

  if (!match) {
    return false;
  }

  const date = new Date(`${value}T12:00:00Z`);

  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
};

/** Calendar days from `from` to `to`, both included. */
export const calendarDays = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) /
      86_400_000,
  ) + 1;

const WEEK_DAYS = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"] as const;
export type WeekDay = (typeof WEEK_DAYS)[number];

export const WEEK_DAY_LABELS: Record<WeekDay, string> = {
  dom: "domingo",
  lun: "lunes",
  mar: "martes",
  mie: "miércoles",
  jue: "jueves",
  vie: "viernes",
  sab: "sábado",
};

/**
 * Days of the range the person works by their schedule: every day but their
 * rest day (person_schedules.rest_day). With no rest day captured, every
 * calendar day counts.
 */
export const workingDaysInRange = (
  from: string,
  to: string,
  restDay: WeekDay | null,
) => {
  const total = calendarDays(from, to);

  if (!restDay) {
    return total;
  }

  let count = 0;
  const cursor = new Date(`${from}T12:00:00Z`);

  for (let index = 0; index < total; index += 1) {
    if (WEEK_DAYS[cursor.getUTCDay()] !== restDay) {
      count += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return count;
};

export const rangesOverlap = (
  a: { startDate: string; endDate: string },
  b: { startDate: string; endDate: string },
) => a.startDate <= b.endDate && b.startDate <= a.endDate;

const cleanText = (value: string | null | undefined) => {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
};

export type RequestInput = {
  kind: string;
  startDate: string;
  endDate: string;
  days: string;
  note?: string | null;
};

export type ParsedRequest = {
  kind: TimeOffKind;
  startDate: string;
  endDate: string;
  /** As stored: "1", "0.5", "2.5". */
  days: string;
  halves: number;
  note: string | null;
};

/** Checks what the employee typed. Balance and overlaps need the database. */
export const parseRequestInput = (
  input: RequestInput,
  today: string,
): { ok: true; value: ParsedRequest } | { ok: false; error: string } => {
  if (!(TIME_OFF_KINDS as readonly string[]).includes(input.kind)) {
    return { ok: false, error: REQUEST_COPY.kind };
  }

  if (!isIsoDate(input.startDate)) {
    return { ok: false, error: REQUEST_COPY.startDate };
  }

  if (!isIsoDate(input.endDate)) {
    return { ok: false, error: REQUEST_COPY.endDate };
  }

  if (input.endDate < input.startDate) {
    return { ok: false, error: REQUEST_COPY.endBeforeStart };
  }

  if (input.startDate < today) {
    return { ok: false, error: REQUEST_COPY.past };
  }

  const range = calendarDays(input.startDate, input.endDate);

  if (range > MAX_RANGE_DAYS) {
    return { ok: false, error: REQUEST_COPY.tooLong };
  }

  const halves = toHalfUnits(input.days);

  if (halves === null) {
    return { ok: false, error: REQUEST_COPY.days };
  }

  if (halves > range * 2) {
    return { ok: false, error: REQUEST_COPY.daysOverRange };
  }

  const note = cleanText(input.note);

  if (note && note.length > TEXT_LIMIT) {
    return { ok: false, error: REQUEST_COPY.note };
  }

  return {
    ok: true,
    value: {
      kind: input.kind as TimeOffKind,
      startDate: input.startDate,
      endDate: input.endDate,
      days: formatStoredDays(halves),
      halves,
      note,
    },
  };
};

export type Decision = "approve" | "reject";

/** The decision and its reason: a rejection needs one, an approval may carry one. */
export const parseDecision = (
  decision: string,
  reason: string | null | undefined,
):
  | { ok: true; decision: Decision; reason: string | null }
  | { ok: false; error: string } => {
  if (decision !== "approve" && decision !== "reject") {
    return { ok: false, error: REQUEST_COPY.decision };
  }

  const cleaned = cleanText(reason);

  if (cleaned && cleaned.length > TEXT_LIMIT) {
    return { ok: false, error: REQUEST_COPY.reason };
  }

  if (decision === "reject" && !cleaned) {
    return { ok: false, error: REQUEST_COPY.reasonRequired };
  }

  return { ok: true, decision, reason: cleaned };
};

/**
 * Whether the employee may still cancel: a pending request any time, an
 * approved one only before its first day (it voids the vacation row).
 */
export const canCancel = (
  request: { status: TimeOffStatus; startDate: string },
  today: string,
) =>
  request.status === "pending" ||
  (request.status === "approved" && request.startDate > today);

/**
 * Where a decision goes back to: the list, with what was decided
 * (`decidida=aprobada|rechazada`) and `exceso=1` when the approval passed
 * the entitlement (HR registered other days meanwhile).
 */
export const decidedHref = (
  list: string,
  formData: FormData,
  warning: string | null | undefined,
) => {
  const params = new URLSearchParams({
    decidida: formData.get("decision") === "approve" ? "aprobada" : "rechazada",
  });

  if (warning) {
    params.set("exceso", "1");
  }

  return `${list}?${params.toString()}`;
};

/** What the list says after a decision, from decidedHref's parameters. */
export const decidedNotice = (params: {
  decidida?: string | string[];
  exceso?: string | string[];
}) => {
  const decided =
    params.decidida === "aprobada"
      ? "Solicitud aprobada."
      : params.decidida === "rechazada"
        ? "Solicitud rechazada."
        : null;

  if (!decided) {
    return null;
  }

  return params.exceso === "1"
    ? `${decided} Con estos días pasa sus días de derecho de ese año; revísalo con RH.`
    : decided;
};

/** "vacaciones" or "permiso", the word the notifications use. */
export const notificationKind = (kind: TimeOffKind) =>
  kind === "vacaciones" ? ("vacaciones" as const) : ("permiso" as const);

export const permisoPay = (kind: TimeOffKind) =>
  kind === "permiso_sin_goce" ? ("sin_goce" as const) : ("con_goce" as const);
