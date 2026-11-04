import { and, desc, eq, inArray } from "drizzle-orm";

import { recordAuditEvent } from "@/lib/audit";
import { tdb, withTransaction } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/errors";
import {
  onboardingIntakes,
  onboardings,
  people,
  type OnboardingIntake,
  type OnboardingIntakeReturnReason,
} from "@/lib/db/schema";
import { ONBOARDING_INTAKE_RETURN_REASONS } from "@/lib/db/schema/onboarding-intakes";
import type { EmployeeContext } from "@/lib/employee-accounts/sign-in";
import { getPersonWithRelations, updatePerson } from "@/lib/people";
import { personFormFromRecord } from "@/lib/people/form-values";
import { DuplicateIdentityError } from "@/lib/people/identity";
import { personFormSchema } from "@/lib/people/schema";
import { getCurrentPrivacyNotice, pendingPrivacyNotice } from "@/lib/privacy";
import {
  createNotifications,
  hrRecipientsWithPermission,
  sendNotificationsSoon,
} from "@/lib/notifications";
import { formatPersonName } from "@/lib/people/schema";
import { withTenant } from "@/lib/tenant/scope";

import {
  countIntakeFields,
  INTAKE_COPY,
  INTAKE_FIELDS,
  intakeDraftSchema,
  intakeShare,
  intakeSubmitSchema,
  mergeIntakeIntoPerson,
  readIntakeData,
  type IntakeData,
} from "./intake-schema";

/**
 * Self-service onboarding (W2-10). HR opens the form from an alta in
 * «Captura RH»; the new hire saves and sends it from /mi; HR applies it to
 * the expediente (the person form's own update, so identity checks and the
 * audit trail are the usual ones) or sends it back with a reason from a
 * closed list. The employee never writes the people row.
 */

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const fail = (error: string) => ({ ok: false, error }) as const;

const isOpenAlta = (stage: string) => stage === "rh_captura";

/** Field names only: the values are personal data and stay out of the audit log. */
const filledKeys = (data: Partial<IntakeData>) =>
  [...INTAKE_FIELDS.map((field) => field.key), "beneficiarios" as const].filter(
    (key) => {
      const value = data[key];
      return Array.isArray(value) ? value.length > 0 : Boolean(value);
    },
  );

// ---------------------------------------------------------------- HR

export const getIntakeForOnboarding = async (
  companyId: string,
  onboardingId: string,
) => {
  const [row] = await tdb(companyId)
    .select()
    .from(onboardingIntakes)
    .where(
      withTenant(
        onboardingIntakes,
        companyId,
        eq(onboardingIntakes.onboardingId, onboardingId),
      ),
    )
    .limit(1);
  return row ?? null;
};

/** HR opens self-service on an alta in «Captura RH»: one form per alta. */
export const openSelfService = async (
  companyId: string,
  onboardingId: string,
  actorUserId: string,
): Promise<Result<OnboardingIntake>> => {
  const [alta] = await tdb(companyId)
    .select({
      id: onboardings.id,
      personId: onboardings.personId,
      stage: onboardings.stage,
    })
    .from(onboardings)
    .where(withTenant(onboardings, companyId, eq(onboardings.id, onboardingId)))
    .limit(1);

  if (!alta) return fail("Alta no encontrada.");
  if (!isOpenAlta(alta.stage)) return fail(INTAKE_COPY.hrNotOpen);

  try {
    const created = await withTransaction(async (tx) => {
      const [row] = await tx
        .insert(onboardingIntakes)
        .values({
          companyId,
          onboardingId,
          personId: alta.personId,
          invitedBy: actorUserId,
        })
        .returning();

      await recordAuditEvent(
        {
          companyId,
          actorUserId,
          resourceType: "onboarding",
          resourceId: onboardingId,
          action: "invite",
          payload: {
            summary: "Autoservicio abierto: la persona captura sus datos",
            after: { personId: alta.personId, autoservicio: row.status },
          },
        },
        tx,
      );

      return row;
    }, companyId);

    return { ok: true, value: created };
  } catch (error) {
    if (isUniqueViolation(error)) return fail(INTAKE_COPY.hrExists);
    throw error;
  }
};

/** Loads an intake HR may decide on: sent, and its alta still in «Captura RH». */
const loadForReview = async (companyId: string, onboardingId: string) => {
  const [row] = await tdb(companyId)
    .select({ intake: onboardingIntakes, stage: onboardings.stage })
    .from(onboardingIntakes)
    .innerJoin(
      onboardings,
      and(
        eq(onboardings.companyId, onboardingIntakes.companyId),
        eq(onboardings.id, onboardingIntakes.onboardingId),
      ),
    )
    .where(
      withTenant(
        onboardingIntakes,
        companyId,
        eq(onboardingIntakes.onboardingId, onboardingId),
      ),
    )
    .limit(1);

  if (!row) return fail("Esta alta no tiene autoservicio.");
  if (!isOpenAlta(row.stage)) return fail(INTAKE_COPY.hrNotOpen);
  if (row.intake.status !== "enviado") return fail(INTAKE_COPY.hrNotSent);
  return { ok: true, value: row.intake } as const;
};

const IDENTITY_LABELS: Record<string, string> = {
  curp: "CURP",
  rfc: "RFC",
  nss: "NSS",
};

/**
 * HR applies what the person sent to the expediente, through the person
 * form's own update. Then the intake closes with how many fields came from
 * the person. Two steps, not one transaction: if the second loses a race,
 * the person already holds the same values and nothing is lost.
 */
export const applyIntake = async (
  companyId: string,
  onboardingId: string,
  actorUserId: string,
): Promise<Result<{ filled: number; total: number }>> => {
  const loaded = await loadForReview(companyId, onboardingId);
  if (!loaded.ok) return loaded;
  const intake = loaded.value;

  const person = await getPersonWithRelations(companyId, intake.personId);
  if (!person) return fail("Persona no encontrada.");

  const data = readIntakeData(intake.data);
  const parsed = personFormSchema.safeParse(
    mergeIntakeIntoPerson(personFormFromRecord(person), data),
  );

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(
      `No se pudo aplicar: ${issue?.message ?? "revisa los datos"} (${String(issue?.path[0] ?? "")}).`,
    );
  }

  try {
    const updated = await updatePerson(
      companyId,
      intake.personId,
      parsed.data,
      actorUserId,
    );
    if (!updated) return fail("Persona no encontrada.");
  } catch (error) {
    if (error instanceof DuplicateIdentityError) {
      return fail(
        `Ya hay otro expediente con este ${error.fields.map((field) => IDENTITY_LABELS[field] ?? field).join(", ")}. Devuélvelo a la persona o corrígelo en el expediente.`,
      );
    }
    throw error;
  }

  const counted = countIntakeFields(data);

  const closed = await withTransaction(async (tx) => {
    const [row] = await tx
      .update(onboardingIntakes)
      .set({
        status: "aplicado",
        fieldsTotal: counted.total,
        fieldsByEmployee: counted.filled,
        reviewedBy: actorUserId,
        reviewedAt: new Date(),
      })
      .where(
        withTenant(
          onboardingIntakes,
          companyId,
          eq(onboardingIntakes.id, intake.id),
          eq(onboardingIntakes.status, "enviado"),
        ),
      )
      .returning();

    if (!row) return null;

    await recordAuditEvent(
      {
        companyId,
        actorUserId,
        resourceType: "onboarding",
        resourceId: onboardingId,
        action: "approve",
        payload: {
          summary: `Autoservicio aplicado al expediente: ${counted.filled} de ${counted.total} campos los llenó la persona (${intakeShare(counted)} %)`,
          after: {
            autoservicio: row.status,
            campos: filledKeys(data),
          },
        },
      },
      tx,
    );

    return row;
  }, companyId);

  if (!closed) return fail("El autoservicio cambió; vuelve a cargar el alta.");
  return { ok: true, value: counted };
};

export const isIntakeReturnReason = (
  value: string,
): value is OnboardingIntakeReturnReason =>
  (ONBOARDING_INTAKE_RETURN_REASONS as readonly string[]).includes(value);

/** HR sends it back: the person edits and sends again. */
export const returnIntake = async (
  companyId: string,
  onboardingId: string,
  reason: string,
  actorUserId: string,
): Promise<Result<OnboardingIntake>> => {
  if (!isIntakeReturnReason(reason)) return fail("Elige el motivo.");
  const loaded = await loadForReview(companyId, onboardingId);
  if (!loaded.ok) return loaded;

  const row = await withTransaction(async (tx) => {
    const [updated] = await tx
      .update(onboardingIntakes)
      .set({
        status: "devuelto",
        returnReason: reason,
        reviewedBy: actorUserId,
        reviewedAt: new Date(),
      })
      .where(
        withTenant(
          onboardingIntakes,
          companyId,
          eq(onboardingIntakes.id, loaded.value.id),
          eq(onboardingIntakes.status, "enviado"),
        ),
      )
      .returning();

    if (!updated) return null;

    await recordAuditEvent(
      {
        companyId,
        actorUserId,
        resourceType: "onboarding",
        resourceId: onboardingId,
        action: "reject",
        payload: {
          summary: `Autoservicio devuelto a la persona · ${reason}`,
          after: { autoservicio: updated.status, motivo: reason },
        },
      },
      tx,
    );

    return updated;
  }, companyId);

  if (!row) return fail("El autoservicio cambió; vuelve a cargar el alta.");
  return { ok: true, value: row };
};

/** Whether the alta's HR approval must wait for HR to decide on what was sent. */
export const intakeBlocksHrApproval = async (
  companyId: string,
  onboardingId: string,
) => {
  const intake = await getIntakeForOnboarding(companyId, onboardingId);
  return intake?.status === "enviado";
};

// ---------------------------------------------------------------- employee

/**
 * The signed-in person's latest self-service form and whether they may still
 * edit it. Read with the session's company and person only.
 */
export const getEmployeeIntake = async (context: EmployeeContext) => {
  const [row] = await tdb(context.companyId)
    .select({ intake: onboardingIntakes, stage: onboardings.stage })
    .from(onboardingIntakes)
    .innerJoin(
      onboardings,
      and(
        eq(onboardings.companyId, onboardingIntakes.companyId),
        eq(onboardings.id, onboardingIntakes.onboardingId),
      ),
    )
    .where(
      withTenant(
        onboardingIntakes,
        context.companyId,
        eq(onboardingIntakes.personId, context.personId),
      ),
    )
    .orderBy(desc(onboardingIntakes.createdAt))
    .limit(1);

  if (!row) return null;

  const altaOpen = isOpenAlta(row.stage);

  return {
    intake: row.intake,
    data: readIntakeData(row.intake.data),
    altaOpen,
    editable:
      altaOpen &&
      (row.intake.status === "invitado" || row.intake.status === "devuelto"),
  };
};

export type EmployeeIntakeView = NonNullable<
  Awaited<ReturnType<typeof getEmployeeIntake>>
>;

/** Why the person cannot capture right now (privacy notice), or null. */
export const employeeIntakeBlocker = async (context: EmployeeContext) => {
  if (!(await getCurrentPrivacyNotice(context.companyId))) {
    return INTAKE_COPY.noNotice;
  }
  if (await pendingPrivacyNotice(context.companyId, context.personId)) {
    return INTAKE_COPY.noticePending;
  }
  return null;
};

export type SaveIntakeResult =
  | { ok: true; submitted: boolean }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * The person saves a draft or sends it to HR. Each value is checked with
 * the person form's rules; sending also needs every required field.
 */
export const saveEmployeeIntake = async (
  context: EmployeeContext,
  raw: unknown,
  options: { submit: boolean },
): Promise<SaveIntakeResult> => {
  const view = await getEmployeeIntake(context);
  if (!view || !view.altaOpen) return fail(INTAKE_COPY.notOpen);
  if (!view.editable) return fail(INTAKE_COPY.locked);

  const blocker = await employeeIntakeBlocker(context);
  if (blocker) return fail(blocker);

  const parsed = (
    options.submit ? intakeSubmitSchema : intakeDraftSchema
  ).safeParse(raw);

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      fieldErrors[key] ??= issue.message;
    }
    return {
      ok: false,
      error: options.submit
        ? "Revisa los datos marcados antes de enviar."
        : "Revisa los datos marcados.",
      fieldErrors,
    };
  }

  // Store only what the person filled, already normalized.
  const data = Object.fromEntries(
    Object.entries(parsed.data).filter(([, value]) =>
      Array.isArray(value)
        ? value.length > 0
        : value !== undefined && value !== "",
    ),
  );
  const now = new Date();
  let notified: string[] = [];

  const saved = await withTransaction(async (tx) => {
    const [row] = await tx
      .update(onboardingIntakes)
      .set(
        options.submit
          ? {
              data,
              status: "enviado",
              returnReason: null,
              submittedAt: now,
              submittedByAccountId: context.accountId,
            }
          : { data },
      )
      .where(
        withTenant(
          onboardingIntakes,
          context.companyId,
          eq(onboardingIntakes.id, view.intake.id),
          inArray(onboardingIntakes.status, ["invitado", "devuelto"]),
        ),
      )
      .returning();

    if (!row) return null;

    // W2-08: HR hears that there is something to review, in the same commit.
    if (options.submit) {
      const [person] = await tx
        .select({
          nombres: people.nombres,
          apellidoPaterno: people.apellidoPaterno,
          apellidoMaterno: people.apellidoMaterno,
        })
        .from(people)
        .where(
          withTenant(people, context.companyId, eq(people.id, row.personId)),
        )
        .limit(1);
      notified = await createNotifications(
        context.companyId,
        {
          template: "onboarding_submitted",
          data: {
            onboardingId: row.onboardingId,
            personName: person ? formatPersonName(person) : "Una persona",
          },
          recipients: await hrRecipientsWithPermission(
            context.companyId,
            "people:update",
          ),
          eventKey: `onboarding_intake:${row.id}:submitted:${now.toISOString()}`,
        },
        tx,
      );
    }

    await recordAuditEvent(
      {
        companyId: context.companyId,
        actorEmployeeAccountId: context.accountId,
        source: "employee",
        resourceType: "onboarding",
        resourceId: row.onboardingId,
        action: "update",
        payload: {
          summary: options.submit
            ? "La persona envió sus datos de alta a RH"
            : "La persona guardó sus datos de alta",
          after: {
            autoservicio: row.status,
            campos: filledKeys(data as Partial<IntakeData>),
          },
        },
      },
      tx,
    );

    return row;
  }, context.companyId);

  if (!saved) return fail(INTAKE_COPY.locked);
  if (notified.length > 0) await sendNotificationsSoon(context.companyId);
  return { ok: true, submitted: options.submit };
};
