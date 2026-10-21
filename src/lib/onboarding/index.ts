import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";

import { recordAuditEvent } from "@/lib/audit";
import { tdb, withTransaction, type DbExecutor } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/errors";
import { onboardings, people } from "@/lib/db/schema";
import type { Onboarding, OnboardingStage } from "@/lib/db/schema";
import {
  isOpenPeriod,
  listEmploymentPeriods,
  syncEmploymentPeriods,
} from "@/lib/people/employment";
import { withTenant } from "@/lib/tenant/scope";

import {
  missingChecklist,
  onboardingChecklistLabels,
  type OnboardingFormValues,
} from "./schema";

/**
 * Hiring (alta) from HR to Payroll with two approvals (WRK-I5-7). Who may
 * approve each stage (people:update, payroll:approve) is checked by the
 * caller; this module keeps the stages and that one user cannot approve both.
 */
export class OnboardingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnboardingError";
  }
}

const snapshot = (row: Onboarding) => ({
  personId: row.personId,
  stage: row.stage,
  checklist: row.checklist,
  infonavit: row.infonavitCredito ? "capturado" : null,
  fonacot: row.fonacotCredito ? "capturado" : null,
  rhApprovedBy: row.rhApprovedBy,
  payrollApprovedBy: row.payrollApprovedBy,
  rejectedReason: row.rejectedReason,
});

const personFields = {
  id: people.id,
  nombres: people.nombres,
  apellidoPaterno: people.apellidoPaterno,
  apellidoMaterno: people.apellidoMaterno,
};

export const listOnboardings = async (
  companyId: string,
  options: { stage?: OnboardingStage } = {},
) =>
  tdb(companyId)
    .select({ onboarding: onboardings, person: personFields })
    .from(onboardings)
    .innerJoin(people, eq(onboardings.personId, people.id))
    .where(
      withTenant(
        onboardings,
        companyId,
        options.stage ? eq(onboardings.stage, options.stage) : undefined,
      ),
    )
    .orderBy(asc(onboardings.stage), desc(onboardings.createdAt));

export const getOnboardingById = async (companyId: string, id: string) => {
  const [row] = await tdb(companyId)
    .select({ onboarding: onboardings, person: personFields })
    .from(onboardings)
    .innerJoin(people, eq(onboardings.personId, people.id))
    .where(withTenant(onboardings, companyId, eq(onboardings.id, id)))
    .limit(1);
  return row ?? null;
};

/** The person's most recent alta (a rehired person may have one per period). */
export const getOnboardingByPerson = async (
  companyId: string,
  personId: string,
) => {
  const [row] = await tdb(companyId)
    .select()
    .from(onboardings)
    .where(
      withTenant(onboardings, companyId, eq(onboardings.personId, personId)),
    )
    .orderBy(desc(onboardings.createdAt))
    .limit(1);
  return row ?? null;
};

/**
 * The alta that blocks starting another one (Iniciativa 2): the one of the
 * person's open employment period, or one still in progress from an earlier
 * period. Without periods yet (before the backfill), any alta of the person,
 * as before migration 0025.
 */
export const findBlockingOnboarding = async (
  companyId: string,
  personId: string,
  executor: DbExecutor = tdb(companyId),
) => {
  const periods = await listEmploymentPeriods(companyId, personId, executor);
  const open = periods.find(isOpenPeriod);
  const ofPerson = eq(onboardings.personId, personId);
  const [row] = await executor
    .select()
    .from(onboardings)
    .where(
      withTenant(
        onboardings,
        companyId,
        ofPerson,
        open
          ? or(
              eq(onboardings.employmentPeriodId, open.id),
              inArray(onboardings.stage, ["rh_captura", "pendiente_nominas"]),
              // Recorded before the person's periods existed: their first period.
              periods.length === 1
                ? isNull(onboardings.employmentPeriodId)
                : undefined,
            )
          : undefined,
      ),
    )
    .orderBy(desc(onboardings.createdAt))
    .limit(1);
  return row ?? null;
};

/**
 * Starts the alta of an active person of the company: one per employment
 * period, so a rehired person can get a new one.
 */
export const startOnboarding = async (
  companyId: string,
  personId: string,
  actorUserId: string,
  input?: OnboardingFormValues,
) => {
  const [person] = await tdb(companyId)
    .select({ id: people.id, status: people.status })
    .from(people)
    .where(
      withTenant(
        people,
        companyId,
        eq(people.id, personId),
        isNull(people.deletedAt),
      ),
    )
    .limit(1);

  if (!person) {
    throw new OnboardingError("Persona no encontrada.");
  }

  if (person.status !== "activa") {
    throw new OnboardingError("La persona está dada de baja.");
  }

  return withTransaction(async (tx) => {
    // The alta belongs to the open employment period (opened here if missing).
    await syncEmploymentPeriods(tx, companyId, [personId], actorUserId);

    if (await findBlockingOnboarding(companyId, personId, tx)) {
      throw new OnboardingError("Esta persona ya tiene un alta.");
    }

    const open = (await listEmploymentPeriods(companyId, personId, tx)).find(
      isOpenPeriod,
    );
    const [created] = await tx
      .insert(onboardings)
      .values({
        companyId,
        personId,
        employmentPeriodId: open?.id ?? null,
        createdBy: actorUserId,
        ...(input ? captureValues(input) : {}),
      })
      .returning()
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw new OnboardingError("Esta persona ya tiene un alta.");
        }
        throw error;
      });

    await recordAuditEvent(
      {
        companyId,
        actorUserId,
        resourceType: "onboarding",
        resourceId: created.id,
        action: "create",
        payload: {
          summary: "Alta iniciada (captura RH)",
          after: snapshot(created),
        },
      },
      tx,
    );

    return created;
  }, companyId);
};

const captureValues = (input: OnboardingFormValues) => ({
  checklist: input.checklist,
  infonavitCredito: input.infonavitCredito,
  infonavitTipoDescuento: input.infonavitTipoDescuento,
  infonavitFactor:
    input.infonavitFactor === null ? null : String(input.infonavitFactor),
  fonacotCredito: input.fonacotCredito,
  fonacotDescuento:
    input.fonacotDescuento === null ? null : String(input.fonacotDescuento),
});

const loadOpen = async (companyId: string, id: string) => {
  const row = await getOnboardingById(companyId, id);

  if (!row) {
    throw new OnboardingError("Alta no encontrada.");
  }

  if (
    row.onboarding.stage === "completo" ||
    row.onboarding.stage === "rechazado"
  ) {
    throw new OnboardingError("El alta ya está cerrada.");
  }

  return row.onboarding;
};

/** Saves the checklist and Infonavit/Fonacot while the alta is open. */
export const updateOnboarding = async (
  companyId: string,
  id: string,
  input: OnboardingFormValues,
  actorUserId: string,
) => {
  const existing = await loadOpen(companyId, id);

  return withTransaction(async (tx) => {
    const [updated] = await tx
      .update(onboardings)
      .set(captureValues(input))
      .where(withTenant(onboardings, companyId, eq(onboardings.id, id)))
      .returning();

    await recordAuditEvent(
      {
        companyId,
        actorUserId,
        resourceType: "onboarding",
        resourceId: id,
        action: "update",
        payload: {
          summary: "Captura del alta",
          before: snapshot(existing),
          after: snapshot(updated),
        },
      },
      tx,
    );

    return updated;
  }, companyId);
};

/**
 * Approves the current stage: HR (checklist complete) moves it to Payroll;
 * Payroll completes it, and must be a different user from who approved HR.
 */
export const approveOnboardingStep = async (
  companyId: string,
  id: string,
  actorUserId: string,
) => {
  const existing = await loadOpen(companyId, id);
  const isHrStage = existing.stage === "rh_captura";

  if (isHrStage) {
    const missing = missingChecklist(existing.checklist);

    if (missing.length > 0) {
      throw new OnboardingError(
        `Falta en el checklist: ${missing.map((item) => onboardingChecklistLabels[item]).join(", ")}.`,
      );
    }
  } else if (existing.rhApprovedBy === actorUserId) {
    throw new OnboardingError(
      "La misma persona no puede aprobar las dos etapas del alta.",
    );
  }

  const now = new Date();

  return withTransaction(async (tx) => {
    const [updated] = await tx
      .update(onboardings)
      .set(
        isHrStage
          ? {
              stage: "pendiente_nominas",
              rhApprovedBy: actorUserId,
              rhApprovedAt: now,
            }
          : {
              stage: "completo",
              payrollApprovedBy: actorUserId,
              payrollApprovedAt: now,
            },
      )
      .where(
        withTenant(
          onboardings,
          companyId,
          and(eq(onboardings.id, id), eq(onboardings.stage, existing.stage)),
        ),
      )
      .returning();

    if (!updated) {
      throw new OnboardingError("El alta cambió de etapa; vuelve a cargarla.");
    }

    await recordAuditEvent(
      {
        companyId,
        actorUserId,
        resourceType: "onboarding",
        resourceId: id,
        action: "approve",
        payload: {
          summary: isHrStage
            ? "Visto bueno de RH: pasa a Nóminas"
            : "Visto bueno de Nóminas: alta completa",
          before: snapshot(existing),
          after: snapshot(updated),
        },
      },
      tx,
    );

    return updated;
  }, companyId);
};

/** Payroll sends it back as rejected, with the reason. */
export const rejectOnboarding = async (
  companyId: string,
  id: string,
  reason: string,
  actorUserId: string,
) => {
  const existing = await loadOpen(companyId, id);
  const motivo = reason.trim();

  if (!motivo) {
    throw new OnboardingError("Indica el motivo del rechazo.");
  }

  return withTransaction(async (tx) => {
    const [updated] = await tx
      .update(onboardings)
      .set({
        stage: "rechazado",
        rejectedBy: actorUserId,
        rejectedAt: new Date(),
        rejectedReason: motivo,
      })
      .where(withTenant(onboardings, companyId, eq(onboardings.id, id)))
      .returning();

    await recordAuditEvent(
      {
        companyId,
        actorUserId,
        resourceType: "onboarding",
        resourceId: id,
        action: "reject",
        payload: {
          summary: `Alta rechazada · Motivo: ${motivo}`,
          before: snapshot(existing),
          after: snapshot(updated),
        },
      },
      tx,
    );

    return updated;
  }, companyId);
};
