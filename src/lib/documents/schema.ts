import { z } from "zod";

import {
  ONBOARDING_CHECKLIST,
  onboardingChecklistLabels,
  type OnboardingChecklistItem,
} from "@/lib/onboarding/schema";

/** Days before expires_on in which a delivered paper is «expiring». */
export const EXPIRING_WITHIN_DAYS = 30;

export const DOCUMENT_STATUSES = [
  "missing",
  "valid",
  "expiring",
  "expired",
] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/**
 * Constancia fiscal and bank account are on the alta checklist, but they are
 * not required by law, so the seed copies the name and leaves required false.
 */
const NOT_REQUIRED_BY_LAW = new Set<OnboardingChecklistItem>([
  "constancia_fiscal",
  "cuenta_bancaria",
]);

/**
 * Default requirements copied from the alta checklist (names, plus whether
 * the paper is required). A company gets them when it activates the module,
 * for every position (position_id null). No files and no document numbers.
 */
export const DEFAULT_DOCUMENT_REQUIREMENTS = ONBOARDING_CHECKLIST.map(
  (item, sort) => ({
    name: onboardingChecklistLabels[item],
    required: !NOT_REQUIRED_BY_LAW.has(item),
    sort,
  }),
);

/** Same folding as catalogKey, so «INE» and «ine» are one requirement. */
export const requirementNameKey = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Usa una fecha AAAA-MM-DD");

const isRealIsoDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));

  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
};

const requirementItemSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z
      .string()
      .trim()
      .min(1, "El nombre es obligatorio")
      .max(120, "Máximo 120 caracteres"),
    required: z.boolean(),
    validityMonths: z.number().int().min(1).max(120).nullable(),
    sort: z.number().int().min(0).max(10_000),
    active: z.boolean(),
  })
  .strict();

/** Replaces the live requirements of one scope (a position, or every position). */
export const setRequirementsSchema = z
  .object({
    positionId: z.string().uuid().nullable(),
    requirements: z.array(requirementItemSchema).max(50),
  })
  .strict()
  .superRefine((data, ctx) => {
    const names = data.requirements.map((item) =>
      requirementNameKey(item.name),
    );

    if (new Set(names).size !== names.length) {
      ctx.addIssue({
        code: "custom",
        message: "Hay nombres repetidos.",
        path: ["requirements"],
      });
    }

    const ids = data.requirements.flatMap((item) => (item.id ? [item.id] : []));

    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: "custom",
        message: "Hay requisitos repetidos.",
        path: ["requirements"],
      });
    }
  });

export type SetRequirementsInput = z.infer<typeof setRequirementsSchema>;

/**
 * Records a delivery date. Strict on purpose: no note, result or observation
 * (a medical exam is only the date).
 */
export const recordDeliverySchema = z
  .object({
    personId: z.string().uuid(),
    requirementId: z.string().uuid(),
    deliveredOn: isoDate,
    expiresOn: isoDate.nullable().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (!isRealIsoDate(data.deliveredOn)) {
      ctx.addIssue({
        code: "custom",
        message: "La fecha de entrega no existe.",
        path: ["deliveredOn"],
      });
    }

    if (data.expiresOn && !isRealIsoDate(data.expiresOn)) {
      ctx.addIssue({
        code: "custom",
        message: "La fecha de vencimiento no existe.",
        path: ["expiresOn"],
      });
    }

    if (
      data.expiresOn &&
      isRealIsoDate(data.deliveredOn) &&
      isRealIsoDate(data.expiresOn) &&
      data.expiresOn < data.deliveredOn
    ) {
      ctx.addIssue({
        code: "custom",
        message: "La vigencia no puede ser anterior a la entrega.",
        path: ["expiresOn"],
      });
    }
  });

export type RecordDeliveryInput = z.infer<typeof recordDeliverySchema>;

export type RequirementStatusInput = {
  required?: boolean;
};

export type DocumentStatusInput = {
  expiresOn: string | null;
} | null;

const DAY_MS = 86_400_000;

/** Calendar day of an ISO string. The date is the first 10 characters. */
const calendarDay = (iso: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);

  if (!match || !isRealIsoDate(match[0])) {
    throw new Error("Fecha ISO inválida.");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  return Date.UTC(year, month - 1, day);
};

/** Adds calendar months, clamping the day to the end of the target month. */
export const addCalendarMonths = (isoDate: string, months: number) => {
  const [year, month, day] = isoDate.split("-").map(Number);
  const target = month - 1 + months;
  const targetYear = year + Math.floor(target / 12);
  const targetMonth = ((target % 12) + 12) % 12;
  const lastDay = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();
  const clamped = Math.min(day, lastDay);
  const pad = (value: number) => String(value).padStart(2, "0");

  return `${targetYear}-${pad(targetMonth + 1)}-${pad(clamped)}`;
};

/**
 * missing when there is no delivery; otherwise valid, expiring (expires_on
 * is today or within 30 days) or expired (the day after expires_on).
 *
 * `today` must be the company's local calendar date, `YYYY-MM-DD` from
 * `isoToday()` in `@/lib/format/date` (America/Mexico_City). Do not pass
 * `new Date().toISOString()`: that instant is UTC and in the evening it is
 * already the next calendar day. Only the first 10 characters are read.
 * `requirement` is part of the signature so callers pass the catalog row;
 * the chip depends on the date, not on required.
 */
export const statusOf = (
  requirement: RequirementStatusInput,
  document: DocumentStatusInput,
  today: string,
): DocumentStatus => {
  void requirement;
  const todayMs = calendarDay(today);

  if (!document) {
    return "missing";
  }

  if (!document.expiresOn) {
    return "valid";
  }

  const days = Math.round((calendarDay(document.expiresOn) - todayMs) / DAY_MS);

  if (days < 0) {
    return "expired";
  }

  if (days <= EXPIRING_WITHIN_DAYS) {
    return "expiring";
  }

  return "valid";
};

export type DatedDelivery = {
  personId: string;
  requirementId: string;
  deliveredOn: string;
  createdAt?: Date | string | null;
};

const deliveryCreatedAt = (value: Date | string | null | undefined) => {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);

    return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
  }

  return Number.NEGATIVE_INFINITY;
};

const isNewerDelivery = (candidate: DatedDelivery, current: DatedDelivery) => {
  if (candidate.deliveredOn !== current.deliveredOn) {
    return candidate.deliveredOn > current.deliveredOn;
  }

  const candidateAt = deliveryCreatedAt(candidate.createdAt);
  const currentAt = deliveryCreatedAt(current.createdAt);

  if (candidateAt !== currentAt) {
    return candidateAt > currentAt;
  }

  return true;
};

/**
 * The row to pass to statusOf: the latest delivered_on for each person and
 * requirement. The same day keeps the later createdAt, and a tie there keeps
 * the later item in the list. Older rows stay in the history.
 */
export const latestDelivery = <T extends DatedDelivery>(
  documents: readonly T[],
): T[] => {
  const byPair = new Map<string, T>();

  for (const document of documents) {
    const key = `${document.personId}\0${document.requirementId}`;
    const current = byPair.get(key);

    if (!current || isNewerDelivery(document, current)) {
      byPair.set(key, document);
    }
  }

  return [...byPair.values()];
};

const NO_VENCE_VALUES = new Set(["on", "true", "1"]);

/**
 * Form field → recordDelivery.expiresOn.
 *
 * A missing or blank expiresOn was not sent: leave it undefined so the
 * domain fills it from validity_months. `noVence` (on, true or 1) is the
 * explicit «does not expire» field and stores null, even when a date was
 * also posted. Any other non-empty expiresOn is that date.
 */
export const expiresOnFromForm = (
  expiresOn: unknown,
  noVence: unknown,
): string | null | undefined => {
  if (typeof noVence === "string" && NO_VENCE_VALUES.has(noVence)) {
    return null;
  }

  if (expiresOn == null) {
    return undefined;
  }

  const value = String(expiresOn).trim();

  return value ? value : undefined;
};
