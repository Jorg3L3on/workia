import { and, desc, eq, isNull } from "drizzle-orm";

import {
  buildChanges,
  recordAuditEvent,
  snapshotVacationRecord,
} from "@/lib/audit";
import { withTransaction } from "@/lib/db";
import {
  employmentPeriods,
  people,
  users,
  vacationRecords,
} from "@/lib/db/schema";
import { formatDateMx } from "@/lib/format/date";
import { withTenant } from "@/lib/tenant/scope";

import {
  VACATION_COPY,
  formatVacationDays,
  previewVacationRegistration,
} from "./balance";
import type { VacationHistoryItem } from "./types";

/**
 * Days-taken ledger (WRK-I14-3). A row is voided by setting voided_at.
 * This module never deletes a row, and it exposes no MCP write.
 * pendiente de contador: the placement rules live in previewVacationRegistration.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type VacationMutation =
  | { ok: true; id: string; warning: string | null }
  | { ok: false; error: string };

const isUuid = (value: string) => UUID.test(value);

/** Non-voided ranges of one person, newest start first. Empty outside the company. */
export const listVacationRecords = async (
  companyId: string,
  personId: string,
): Promise<VacationHistoryItem[]> => {
  if (!isUuid(personId)) {
    return [];
  }

  const rows = await withTransaction(
    (tx) =>
      tx
        .select({
          id: vacationRecords.id,
          startDate: vacationRecords.startDate,
          endDate: vacationRecords.endDate,
          days: vacationRecords.days,
          serviceYear: vacationRecords.serviceYear,
          note: vacationRecords.note,
          createdByName: users.name,
        })
        .from(vacationRecords)
        .leftJoin(users, eq(vacationRecords.createdBy, users.id))
        .where(
          withTenant(
            vacationRecords,
            companyId,
            eq(vacationRecords.personId, personId),
            isNull(vacationRecords.voidedAt),
          ),
        )
        .orderBy(
          desc(vacationRecords.startDate),
          desc(vacationRecords.createdAt),
        ),
    companyId,
  );

  return rows;
};

export type RegisterVacationInput = {
  personId: string;
  startDate: string;
  endDate: string;
  days: string;
  note?: string | null;
};

/**
 * Inserts one range. Null when the person is not in the company (the same
 * answer a missing id gets). A warning means the days pass the entitlement
 * and the row was still saved.
 */
export const registerVacationRecord = async (
  companyId: string,
  input: RegisterVacationInput,
  actorUserId?: string | null,
): Promise<VacationMutation | null> => {
  if (!isUuid(input.personId)) {
    return null;
  }

  return withTransaction(async (tx) => {
    const [person] = await tx
      .select({
        id: people.id,
        fechaIngreso: people.fechaIngreso,
        deletedAt: people.deletedAt,
      })
      .from(people)
      .where(withTenant(people, companyId, eq(people.id, input.personId)))
      .for("update");

    if (!person || person.deletedAt) {
      return null;
    }

    const periods = await tx
      .select({
        id: employmentPeriods.id,
        fechaIngreso: employmentPeriods.fechaIngreso,
        fechaBaja: employmentPeriods.fechaBaja,
        bajaSinFecha: employmentPeriods.bajaSinFecha,
        reconoceAntiguedad: employmentPeriods.reconoceAntiguedad,
        fechaAntiguedadReconocida: employmentPeriods.fechaAntiguedadReconocida,
      })
      .from(employmentPeriods)
      .where(
        withTenant(
          employmentPeriods,
          companyId,
          eq(employmentPeriods.personId, person.id),
        ),
      );

    const existing = await tx
      .select({
        startDate: vacationRecords.startDate,
        endDate: vacationRecords.endDate,
        serviceYear: vacationRecords.serviceYear,
        days: vacationRecords.days,
        voidedAt: vacationRecords.voidedAt,
      })
      .from(vacationRecords)
      .where(
        withTenant(
          vacationRecords,
          companyId,
          eq(vacationRecords.personId, person.id),
        ),
      )
      .for("update");

    const preview = previewVacationRegistration({
      periods,
      fallbackFechaIngreso: person.fechaIngreso,
      startDate: input.startDate,
      endDate: input.endDate,
      days: input.days,
      note: input.note,
      existing: existing.map((row) => ({
        startDate: row.startDate,
        endDate: row.endDate,
        serviceYear: row.serviceYear,
        days: row.days,
        voided: row.voidedAt !== null,
      })),
    });

    if (!preview.ok) {
      return preview;
    }

    const [created] = await tx
      .insert(vacationRecords)
      .values({
        companyId,
        personId: person.id,
        employmentPeriodId: preview.periodId,
        serviceYear: preview.serviceYear,
        startDate: input.startDate,
        endDate: input.endDate,
        days: preview.days,
        note: preview.note,
        createdBy: actorUserId ?? null,
      })
      .returning();

    await recordAuditEvent(
      {
        companyId,
        actorUserId,
        resourceType: "vacation_record",
        resourceId: created.id,
        action: "create",
        payload: {
          after: snapshotVacationRecord(created),
          summary: `Vacaciones registradas del ${formatDateMx(created.startDate)} al ${formatDateMx(created.endDate)} (${formatVacationDays(created.days)})`,
        },
      },
      tx,
    );

    return { ok: true, id: created.id, warning: preview.warning };
  }, companyId);
};

/**
 * Soft-void. Null when the id is not in the company. An already voided row
 * is an error and stays as it was. The row is not deleted.
 */
export const voidVacationRecord = async (
  companyId: string,
  recordId: string,
  actorUserId?: string | null,
): Promise<VacationMutation | null> => {
  if (!isUuid(recordId)) {
    return null;
  }

  return withTransaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(vacationRecords)
      .where(
        withTenant(
          vacationRecords,
          companyId,
          eq(vacationRecords.id, recordId),
        ),
      )
      .for("update");

    if (!current) {
      return null;
    }

    if (current.voidedAt) {
      return { ok: false, error: VACATION_COPY.alreadyVoided };
    }

    const [updated] = await tx
      .update(vacationRecords)
      .set({ voidedAt: new Date() })
      .where(
        and(
          eq(vacationRecords.companyId, companyId),
          eq(vacationRecords.id, current.id),
          isNull(vacationRecords.voidedAt),
        ),
      )
      .returning();

    if (!updated) {
      return { ok: false, error: VACATION_COPY.alreadyVoided };
    }

    const before = snapshotVacationRecord(current);
    const after = snapshotVacationRecord(updated);

    await recordAuditEvent(
      {
        companyId,
        actorUserId,
        resourceType: "vacation_record",
        resourceId: current.id,
        action: "delete",
        payload: {
          before,
          after,
          changes: buildChanges(before, after, ["voidedAt"]),
          summary: `Vacaciones anuladas del ${formatDateMx(current.startDate)} al ${formatDateMx(current.endDate)}`,
        },
      },
      tx,
    );

    return { ok: true, id: updated.id, warning: null };
  }, companyId);
};
