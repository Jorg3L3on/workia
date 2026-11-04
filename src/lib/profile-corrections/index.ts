import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { recordAuditEvent } from "@/lib/audit";
import { tdb, withTransaction } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/errors";
import { clampPageSize, defineKeyset } from "@/lib/db/keyset";
import { people, profileCorrections } from "@/lib/db/schema";
import { getEmployeeExpediente } from "@/lib/employee/expediente";
import {
  correctableField,
  expedienteValues,
  type ExpedienteFieldKey,
} from "@/lib/employee/expediente-model";
import type { EmployeeContext } from "@/lib/employee-accounts/sign-in";
import { isoToday } from "@/lib/format/date";
import { formatPersonName } from "@/lib/people/schema";
import { withTenant } from "@/lib/tenant/scope";

import { PROFILE_CORRECTION_LIMITS } from "./labels";

/**
 * Correction requests from Mi expediente (Workia 2.0 W2-02,
 * docs/mi-expediente.md). The employee side takes the guard's context, never
 * an id from the request, and only touches their own person's rows. The HR
 * side takes the active company and is gated by people:update in the actions.
 */

export const PROFILE_CORRECTION_COPY = {
  unknownField: "Ese dato no se puede corregir desde la app.",
  emptyValue: "Escribe cómo debe quedar el dato.",
  longValue: `Escribe máximo ${PROFILE_CORRECTION_LIMITS.value} caracteres.`,
  longNote: `El comentario puede tener máximo ${PROFILE_CORRECTION_LIMITS.note} caracteres.`,
  sameValue: "Es el mismo dato que ya tienes en tu expediente.",
  duplicate:
    "Ya enviaste una corrección de este dato. Espera a que RH la revise o cancélala.",
  notFound: "No encontramos esa solicitud.",
  notPending: "Esa solicitud ya no está pendiente.",
  reasonRequired: "Escribe por qué se rechaza; la persona lo verá.",
  longReason: `El motivo puede tener máximo ${PROFILE_CORRECTION_LIMITS.reason} caracteres.`,
  denied: "Necesitas permiso para editar personas.",
} as const;

export type CorrectionResult =
  { ok: true; id: string } | { ok: false; error: string };

const normalize = (value: string | null | undefined) =>
  (value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();

const sameText = (a: string | null, b: string) =>
  normalize(a).toLocaleLowerCase("es-MX") ===
  normalize(b).toLocaleLowerCase("es-MX");

/**
 * The employee asks HR to correct one field. «Antes» is computed here from
 * the database, not taken from the form, so HR sees what the record said.
 */
export const requestProfileCorrection = async (
  context: EmployeeContext,
  input: { field: string; proposedValue: string; note?: string },
): Promise<CorrectionResult> => {
  const field = correctableField(input.field);

  if (!field) {
    return { ok: false, error: PROFILE_CORRECTION_COPY.unknownField };
  }

  const proposedValue = normalize(input.proposedValue);
  const note = normalize(input.note) || null;

  if (!proposedValue) {
    return { ok: false, error: PROFILE_CORRECTION_COPY.emptyValue };
  }

  if (proposedValue.length > PROFILE_CORRECTION_LIMITS.value) {
    return { ok: false, error: PROFILE_CORRECTION_COPY.longValue };
  }

  if (note && note.length > PROFILE_CORRECTION_LIMITS.note) {
    return { ok: false, error: PROFILE_CORRECTION_COPY.longNote };
  }

  const expediente = await getEmployeeExpediente(context);

  if (!expediente) {
    return { ok: false, error: PROFILE_CORRECTION_COPY.notFound };
  }

  const currentValue = expedienteValues(expediente, isoToday())[
    field.key as ExpedienteFieldKey
  ];

  if (sameText(currentValue, proposedValue)) {
    return { ok: false, error: PROFILE_CORRECTION_COPY.sameValue };
  }

  try {
    const id = await withTransaction(async (tx) => {
      const [created] = await tx
        .insert(profileCorrections)
        .values({
          companyId: context.companyId,
          personId: context.personId,
          accountId: context.accountId,
          field: field.key,
          currentValue,
          proposedValue,
          note,
        })
        .returning({ id: profileCorrections.id });

      await recordAuditEvent(
        {
          companyId: context.companyId,
          actorEmployeeAccountId: context.accountId,
          resourceType: "profile_correction",
          resourceId: created.id,
          action: "create",
          source: "employee",
          payload: {
            summary: `Solicitó corregir ${field.label}`,
            before: { personId: context.personId, [field.key]: currentValue },
            after: { personId: context.personId, [field.key]: proposedValue },
          },
        },
        tx,
      );

      return created.id;
    }, context.companyId);

    return { ok: true, id };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: PROFILE_CORRECTION_COPY.duplicate };
    }

    throw error;
  }
};

/** The employee withdraws one of their own pending requests. */
export const cancelProfileCorrection = async (
  context: EmployeeContext,
  id: string,
): Promise<CorrectionResult> => {
  if (!isUuid(id)) {
    return { ok: false, error: PROFILE_CORRECTION_COPY.notFound };
  }

  return withTransaction(async (tx) => {
    const [updated] = await tx
      .update(profileCorrections)
      .set({ status: "cancelada", decidedAt: new Date() })
      .where(
        withTenant(
          profileCorrections,
          context.companyId,
          eq(profileCorrections.id, id),
          eq(profileCorrections.personId, context.personId),
          eq(profileCorrections.status, "pendiente"),
        ),
      )
      .returning({
        id: profileCorrections.id,
        field: profileCorrections.field,
      });

    if (!updated) {
      return { ok: false, error: PROFILE_CORRECTION_COPY.notPending };
    }

    await recordAuditEvent(
      {
        companyId: context.companyId,
        actorEmployeeAccountId: context.accountId,
        resourceType: "profile_correction",
        resourceId: updated.id,
        action: "cancel",
        source: "employee",
        payload: {
          summary: `Canceló la corrección de ${correctableField(updated.field)?.label ?? updated.field}`,
        },
      },
      tx,
    );

    return { ok: true, id: updated.id };
  }, context.companyId);
};

const correctionColumns = {
  id: profileCorrections.id,
  field: profileCorrections.field,
  currentValue: profileCorrections.currentValue,
  proposedValue: profileCorrections.proposedValue,
  note: profileCorrections.note,
  status: profileCorrections.status,
  decisionReason: profileCorrections.decisionReason,
  decidedAt: profileCorrections.decidedAt,
  createdAt: profileCorrections.createdAt,
};

/** How many of their own requests the employee sees: the latest ones. */
export const OWN_CORRECTIONS_LIMIT = 20;

/** The employee's own requests, newest first. */
export const listOwnProfileCorrections = (context: EmployeeContext) =>
  tdb(context.companyId)
    .select(correctionColumns)
    .from(profileCorrections)
    .where(
      withTenant(
        profileCorrections,
        context.companyId,
        eq(profileCorrections.personId, context.personId),
      ),
    )
    .orderBy(desc(profileCorrections.createdAt), desc(profileCorrections.id))
    .limit(OWN_CORRECTIONS_LIMIT);

export type OwnProfileCorrection = Awaited<
  ReturnType<typeof listOwnProfileCorrections>
>[number];

/** HR inbox order: oldest pending first (profile_corrections_inbox_idx). */
const inboxKeyset = defineKeyset([
  { column: profileCorrections.createdAt, type: "timestamptz" },
  { column: profileCorrections.id, type: "uuid" },
]);

export const INBOX_PAGE_SIZE = 25;

/**
 * HR's «Correcciones»: the company's pending requests, oldest first, one
 * keyset page at a time. People borrados drop out of the list.
 */
export const listPendingProfileCorrections = async (
  companyId: string,
  options: { cursor?: string | null; limit?: number } = {},
) => {
  const limit = clampPageSize(options.limit, INBOX_PAGE_SIZE, 100);
  const rows = await tdb(companyId)
    .select({
      ...correctionColumns,
      personId: profileCorrections.personId,
      nombres: people.nombres,
      apellidoPaterno: people.apellidoPaterno,
      apellidoMaterno: people.apellidoMaterno,
      personStatus: people.status,
      cursor: inboxKeyset.cursor,
    })
    .from(profileCorrections)
    .innerJoin(
      people,
      and(
        eq(people.companyId, profileCorrections.companyId),
        eq(people.id, profileCorrections.personId),
        isNull(people.deletedAt),
      ),
    )
    .where(
      withTenant(
        profileCorrections,
        companyId,
        eq(profileCorrections.status, "pendiente"),
        inboxKeyset.after(options.cursor),
      ),
    )
    .orderBy(...inboxKeyset.orderBy)
    .limit(limit + 1);

  const page = inboxKeyset.page(rows, limit);

  return {
    next: page.next,
    items: page.items.map(
      ({ nombres, apellidoPaterno, apellidoMaterno, ...item }) => ({
        ...item,
        personName: formatPersonName({
          nombres,
          apellidoPaterno,
          apellidoMaterno,
        }),
      }),
    ),
  };
};

export type PendingProfileCorrection = Awaited<
  ReturnType<typeof listPendingProfileCorrections>
>["items"][number];

/** Pending requests of the company, for the inbox heading. */
export const countPendingProfileCorrections = async (companyId: string) => {
  const [row] = await tdb(companyId)
    .select({ count: sql<number>`count(*)::int` })
    .from(profileCorrections)
    .innerJoin(
      people,
      and(
        eq(people.companyId, profileCorrections.companyId),
        eq(people.id, profileCorrections.personId),
        isNull(people.deletedAt),
      ),
    )
    .where(
      withTenant(
        profileCorrections,
        companyId,
        eq(profileCorrections.status, "pendiente"),
      ),
    );

  return row?.count ?? 0;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUuid = (value: string) => UUID.test(value);

/**
 * HR closes a pending request: «aplicada» once the record was fixed in the
 * person form, or «rechazada» with a reason the employee reads. A request of
 * another company is not found.
 */
export const decideProfileCorrection = async (
  companyId: string,
  input: {
    id: string;
    decision: "aplicada" | "rechazada";
    reason?: string;
  },
  actorUserId: string,
): Promise<CorrectionResult> => {
  if (!isUuid(input.id)) {
    return { ok: false, error: PROFILE_CORRECTION_COPY.notFound };
  }

  const reason = normalize(input.reason) || null;

  if (input.decision === "rechazada" && !reason) {
    return { ok: false, error: PROFILE_CORRECTION_COPY.reasonRequired };
  }

  if (reason && reason.length > PROFILE_CORRECTION_LIMITS.reason) {
    return { ok: false, error: PROFILE_CORRECTION_COPY.longReason };
  }

  return withTransaction(async (tx) => {
    const [updated] = await tx
      .update(profileCorrections)
      .set({
        status: input.decision,
        decidedAt: new Date(),
        decidedBy: actorUserId,
        decisionReason: reason,
      })
      .where(
        withTenant(
          profileCorrections,
          companyId,
          eq(profileCorrections.id, input.id),
          eq(profileCorrections.status, "pendiente"),
        ),
      )
      .returning({
        id: profileCorrections.id,
        personId: profileCorrections.personId,
        field: profileCorrections.field,
        currentValue: profileCorrections.currentValue,
        proposedValue: profileCorrections.proposedValue,
      });

    if (!updated) {
      const [exists] = await tx
        .select({ id: profileCorrections.id })
        .from(profileCorrections)
        .where(
          withTenant(
            profileCorrections,
            companyId,
            eq(profileCorrections.id, input.id),
          ),
        )
        .limit(1);

      return {
        ok: false,
        error: exists
          ? PROFILE_CORRECTION_COPY.notPending
          : PROFILE_CORRECTION_COPY.notFound,
      };
    }

    const label = correctableField(updated.field)?.label ?? updated.field;

    await recordAuditEvent(
      {
        companyId,
        actorUserId,
        resourceType: "profile_correction",
        resourceId: updated.id,
        action: input.decision === "aplicada" ? "approve" : "reject",
        payload: {
          summary:
            input.decision === "aplicada"
              ? `Marcó aplicada la corrección de ${label}`
              : `Rechazó la corrección de ${label}: ${reason}`,
          before: {
            personId: updated.personId,
            [updated.field]: updated.currentValue,
          },
          after: {
            personId: updated.personId,
            [updated.field]: updated.proposedValue,
          },
        },
      },
      tx,
    );

    return { ok: true, id: updated.id };
  }, companyId);
};
