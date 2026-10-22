import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

import {
  recordAuditEvent,
  snapshotContract,
  snapshotEmploymentPeriod,
  snapshotPerson,
} from "@/lib/audit";
import type { RecordAuditEventInput } from "@/lib/audit/types";
import {
  tdb,
  withTransaction,
  type DbExecutor,
  type DbTransaction,
} from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/errors";
import {
  contracts,
  employmentPeriods,
  onboardings,
  people,
  terminationReasons,
} from "@/lib/db/schema";
import type { EmploymentPeriod } from "@/lib/db/schema/employment";
import { formatDateMx } from "@/lib/format/date";
import { withTenant } from "@/lib/tenant/scope";

import {
  finiquitoStatusLabels,
  terminationTypeLabels,
  type FiniquitoValues,
  type RehireValues,
  type TerminationValues,
} from "./employment-schema";
import { seniorityDate } from "./seniority";

/**
 * Baja y periodos laborales (Iniciativa 2). Every person has employment
 * periods (employment_periods); people.status and people.fecha_ingreso are
 * derived from the latest one and kept in sync here, in the same transaction,
 * so lists, the export and the connector keep reading them.
 */

/** A business rule refused the change; `field` names the form field. */
export class EmploymentError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "EmploymentError";
  }
}

const periodColumns = {
  period: employmentPeriods,
  motivoBaja: terminationReasons.name,
};

export type EmploymentPeriodRow = EmploymentPeriod & {
  /** Name of the motivo de baja (the catalog may rename it later). */
  motivoBaja: string | null;
};

const toRow = (row: {
  period: EmploymentPeriod;
  motivoBaja: string | null;
}): EmploymentPeriodRow => ({ ...row.period, motivoBaja: row.motivoBaja });

/** Open: no fecha_baja and not a baja «sin fecha». */
export const isOpenPeriod = (period: {
  fechaBaja: string | null;
  bajaSinFecha: boolean;
}) => period.fechaBaja === null && !period.bajaSinFecha;

/** Oldest first: by ingreso, then by when it was recorded. */
const byIngreso = (
  a: Pick<EmploymentPeriod, "fechaIngreso" | "createdAt">,
  b: Pick<EmploymentPeriod, "fechaIngreso" | "createdAt">,
) =>
  (a.fechaIngreso ?? "").localeCompare(b.fechaIngreso ?? "") ||
  a.createdAt.getTime() - b.createdAt.getTime();

const selectPeriods = (
  executor: DbExecutor,
  companyId: string,
  personIds: string[] | null,
) =>
  executor
    .select(periodColumns)
    .from(employmentPeriods)
    .leftJoin(
      terminationReasons,
      and(
        eq(terminationReasons.companyId, employmentPeriods.companyId),
        eq(terminationReasons.id, employmentPeriods.motivoBajaId),
      ),
    )
    .where(
      withTenant(
        employmentPeriods,
        companyId,
        personIds ? inArray(employmentPeriods.personId, personIds) : undefined,
      ),
    )
    .orderBy(
      asc(employmentPeriods.fechaIngreso),
      asc(employmentPeriods.createdAt),
    )
    .then((rows) => rows.map(toRow));

/** Every employment period of a person, oldest first; [] outside the company. */
export const listEmploymentPeriods = async (
  companyId: string,
  personId: string,
  executor: DbExecutor = tdb(companyId),
) => (await selectPeriods(executor, companyId, [personId])).sort(byIngreso);

/**
 * The current (or last) period of a person, as lists, the export and the
 * connector read it. finiquitoMonto is raw: the caller masks it without
 * compensation:read. fechaAntiguedad is seniorityDate() over every period.
 */
export type EmploymentSummary = {
  personId: string;
  periodId: string;
  periodCount: number;
  abierto: boolean;
  fechaIngreso: string | null;
  fechaAntiguedad: string | null;
  reconoceAntiguedad: boolean;
  fechaBaja: string | null;
  bajaSinFecha: boolean;
  tipoBaja: EmploymentPeriod["tipoBaja"];
  motivoBajaId: string | null;
  motivoBaja: string | null;
  comentarioBaja: string | null;
  recontratable: boolean | null;
  finiquitoEstado: EmploymentPeriod["finiquitoEstado"];
  finiquitoFecha: string | null;
  finiquitoMonto: string | null;
  fechaBajaInferida: boolean;
  requiereRevision: boolean;
};

export const summarizePeriods = (
  periods: EmploymentPeriodRow[],
): EmploymentSummary | null => {
  const ordered = [...periods].sort(byIngreso);
  const current = ordered.find(isOpenPeriod) ?? ordered.at(-1);

  if (!current) {
    return null;
  }

  return {
    personId: current.personId,
    periodId: current.id,
    periodCount: ordered.length,
    abierto: isOpenPeriod(current),
    fechaIngreso: current.fechaIngreso,
    fechaAntiguedad: seniorityDate(
      ordered.filter((period) => byIngreso(period, current) <= 0),
    ),
    reconoceAntiguedad: current.reconoceAntiguedad,
    fechaBaja: current.fechaBaja,
    bajaSinFecha: current.bajaSinFecha,
    tipoBaja: current.tipoBaja,
    motivoBajaId: current.motivoBajaId,
    motivoBaja: current.motivoBaja,
    comentarioBaja: current.comentarioBaja,
    recontratable: current.recontratable,
    finiquitoEstado: current.finiquitoEstado,
    finiquitoFecha: current.finiquitoFecha,
    finiquitoMonto: current.finiquitoMonto,
    fechaBajaInferida: current.fechaBajaInferida,
    requiereRevision: current.requiereRevision,
  };
};

/** The current or last period of one person; null without periods or outside the company. */
export const getEmploymentSummary = async (
  companyId: string,
  personId: string,
) => summarizePeriods(await listEmploymentPeriods(companyId, personId));

const SUMMARY_BATCH = 1000;

/**
 * Summaries for many people at once (lists, export): by person id, only the
 * people of the company with at least one period. Without ids, every period
 * of the company. Pass the transaction to read inside one (the importer).
 */
export const listEmploymentSummaries = async (
  companyId: string,
  personIds?: string[],
  executor: DbExecutor = tdb(companyId),
) => {
  const rows: EmploymentPeriodRow[] = [];

  if (personIds) {
    for (let start = 0; start < personIds.length; start += SUMMARY_BATCH) {
      rows.push(
        ...(await selectPeriods(
          executor,
          companyId,
          personIds.slice(start, start + SUMMARY_BATCH),
        )),
      );
    }
  } else {
    rows.push(...(await selectPeriods(executor, companyId, null)));
  }

  const byPerson = new Map<string, EmploymentPeriodRow[]>();

  for (const row of rows) {
    byPerson.set(row.personId, [...(byPerson.get(row.personId) ?? []), row]);
  }

  const summaries = new Map<string, EmploymentSummary>();

  for (const [personId, periods] of byPerson) {
    const summary = summarizePeriods(periods);
    if (summary) summaries.set(personId, summary);
  }

  return summaries;
};

/**
 * Brings the periods of these people in line with people.status and
 * people.fecha_ingreso, for writes that set those directly (alta, edición,
 * importación): an active person gets an open period, a baja closes it «sin
 * fecha» for review, and the latest period follows the ingreso. The first
 * period of a person also takes the altas a nómina recorded before it.
 */
export const syncEmploymentPeriods = async (
  tx: DbTransaction,
  companyId: string,
  personIds: string[],
  actorUserId?: string | null,
) => {
  if (personIds.length === 0) {
    return;
  }

  const persons = await tx
    .select({
      id: people.id,
      status: people.status,
      fechaIngreso: people.fechaIngreso,
    })
    .from(people)
    .where(withTenant(people, companyId, inArray(people.id, personIds)));
  const periods = await selectPeriods(tx, companyId, personIds);

  const opened: (typeof employmentPeriods.$inferInsert)[] = [];
  const firstPeriodOf: string[] = [];

  for (const person of persons) {
    const own = periods
      .filter((period) => period.personId === person.id)
      .sort(byIngreso);
    const open = own.find(isOpenPeriod);
    const latest = open ?? own.at(-1);

    if (person.status === "activa" && !open) {
      const fresh = {
        fechaIngreso: person.fechaIngreso,
        reconoceAntiguedad: false,
      };
      opened.push({
        companyId,
        personId: person.id,
        ...fresh,
        fechaAntiguedad: seniorityDate([...own, fresh]),
        // Reopened outside the reingreso flow: HR completes it.
        requiereRevision: own.length > 0,
        createdBy: actorUserId ?? null,
      });

      if (own.length === 0) firstPeriodOf.push(person.id);
      continue;
    }

    if (person.status === "baja" && !latest) {
      opened.push({
        companyId,
        personId: person.id,
        fechaIngreso: person.fechaIngreso,
        fechaAntiguedad: person.fechaIngreso,
        bajaSinFecha: true,
        requiereRevision: true,
        createdBy: actorUserId ?? null,
      });
      firstPeriodOf.push(person.id);
      continue;
    }

    if (person.status === "baja" && open) {
      await tx
        .update(employmentPeriods)
        .set({ bajaSinFecha: true, requiereRevision: true })
        .where(
          withTenant(
            employmentPeriods,
            companyId,
            eq(employmentPeriods.id, open.id),
          ),
        );
      continue;
    }

    if (latest && latest.fechaIngreso !== person.fechaIngreso) {
      if (
        person.fechaIngreso &&
        latest.fechaBaja &&
        person.fechaIngreso > latest.fechaBaja
      ) {
        throw new EmploymentError(
          "La fecha de ingreso no puede ser posterior a la fecha de baja.",
          "fechaIngreso",
        );
      }

      const moved = own.map((period) =>
        period.id === latest.id
          ? { ...period, fechaIngreso: person.fechaIngreso }
          : period,
      );

      await tx
        .update(employmentPeriods)
        .set({
          fechaIngreso: person.fechaIngreso,
          fechaAntiguedad: seniorityDate(moved),
        })
        .where(
          withTenant(
            employmentPeriods,
            companyId,
            eq(employmentPeriods.id, latest.id),
          ),
        );
    }
  }

  if (opened.length > 0) {
    await tx.insert(employmentPeriods).values(opened);
  }

  if (firstPeriodOf.length > 0) {
    // Altas a nómina recorded before the person had periods belong to the first one.
    await tx.execute(sql`
      update ${onboardings} o set employment_period_id = p.id
      from ${employmentPeriods} p
      where p.company_id = o.company_id and p.person_id = o.person_id
        and o.company_id = ${companyId}
        and o.employment_period_id is null
        and o.person_id in (${sql.join(
          firstPeriodOf.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
    `);
  }
};

/** The person row, locked: bajas and reingresos of one person run one at a time. */
const lockPerson = async (tx: DbTransaction, companyId: string, id: string) => {
  const [person] = await tx
    .select()
    .from(people)
    .where(
      withTenant(
        people,
        companyId,
        eq(people.id, id),
        isNull(people.deletedAt),
      ),
    )
    .for("update");

  return person ?? null;
};

/** finiquito columns to write; the amount only when it was sent. */
const finiquitoValues = (finiquito: FiniquitoValues | undefined) => {
  if (!finiquito) {
    return {};
  }

  return {
    finiquitoEstado: finiquito.estado ?? null,
    finiquitoFecha: finiquito.fecha ?? null,
    ...(finiquito.monto === undefined
      ? {}
      : {
          finiquitoMonto:
            finiquito.monto === null ? null : finiquito.monto.toFixed(2),
        }),
  };
};

const PERIOD_AUDIT_FIELDS = [
  "fechaIngreso",
  "reconoceAntiguedad",
  "fechaAntiguedadReconocida",
  "fechaAntiguedad",
  "fechaBaja",
  "tipoBaja",
  "motivoBaja",
  "comentarioBaja",
  "recontratable",
  "finiquitoEstado",
  "finiquitoFecha",
  "finiquitoMonto",
] as const;

const periodChanges = (
  before: ReturnType<typeof snapshotEmploymentPeriod> | null,
  after: ReturnType<typeof snapshotEmploymentPeriod>,
) => {
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  for (const field of PERIOD_AUDIT_FIELDS) {
    const from = before?.[field] ?? null;
    const to = after[field] ?? null;

    if (from !== to) {
      changes[field] = { from, to };
    }
  }

  return changes;
};

export type TerminationResult = {
  person: typeof people.$inferSelect;
  period: EmploymentPeriod;
  /** The vigente contract that became «Terminado», if there was one. */
  contract: typeof contracts.$inferSelect | null;
  warnings: string[];
};

/** Where a baja comes from, for the audit: the app (default) or an import. */
export type TerminationOptions = {
  source?: NonNullable<RecordAuditEventInput["source"]>;
};

/**
 * The rules of every baja, from the dialog, the connector or an import: the
 * fecha is not before the period's ingreso and the motivo is active in this
 * company's catalog. Returns the motivo. A correction may keep the period's
 * own motivo even if it was deactivated since.
 */
const checkTermination = async (
  tx: DbTransaction,
  companyId: string,
  period: Pick<EmploymentPeriod, "fechaIngreso" | "motivoBajaId">,
  input: Pick<TerminationValues, "fechaBaja" | "motivoBajaId">,
  options: { keepsMotivo?: boolean } = {},
) => {
  const kept =
    options.keepsMotivo && input.motivoBajaId === period.motivoBajaId;

  if (period.fechaIngreso && input.fechaBaja < period.fechaIngreso) {
    throw new EmploymentError(
      `La fecha de baja no puede ser anterior al ingreso (${formatDateMx(period.fechaIngreso)}).`,
      "fechaBaja",
    );
  }

  const [reason] = await tx
    .select()
    .from(terminationReasons)
    .where(
      withTenant(
        terminationReasons,
        companyId,
        eq(terminationReasons.id, input.motivoBajaId),
        isNull(terminationReasons.deletedAt),
        kept ? undefined : eq(terminationReasons.active, true),
      ),
    )
    .limit(1);

  if (!reason) {
    throw new EmploymentError(
      "Elige un motivo de baja activo del catálogo de esta empresa.",
      "motivoBajaId",
    );
  }

  return reason;
};

/** The vigente contract of the person becomes «Terminado» on the baja, audited. */
const terminateVigenteContract = async (
  tx: DbTransaction,
  companyId: string,
  personId: string,
  fechaBaja: string,
  actorUserId: string | null | undefined,
  options: TerminationOptions,
) => {
  const [vigente] = await tx
    .select()
    .from(contracts)
    .where(
      withTenant(
        contracts,
        companyId,
        eq(contracts.personId, personId),
        eq(contracts.status, "vigente"),
        isNull(contracts.deletedAt),
      ),
    )
    .for("update");

  if (!vigente) {
    return null;
  }

  // Ends on the baja; a contract that already ended earlier keeps its end.
  const endDate =
    vigente.endDate && vigente.endDate < fechaBaja
      ? vigente.endDate
      : fechaBaja;
  const [terminated] = await tx
    .update(contracts)
    .set({ status: "terminado", endDate })
    .where(withTenant(contracts, companyId, eq(contracts.id, vigente.id)))
    .returning();

  await recordAuditEvent(
    {
      companyId,
      actorUserId,
      resourceType: "contract",
      resourceId: vigente.id,
      action: "terminado",
      source: options.source,
      payload: {
        before: snapshotContract(vigente),
        after: snapshotContract(terminated),
        changes: {
          status: { from: vigente.status, to: terminated.status },
          ...(vigente.endDate === terminated.endDate
            ? {}
            : {
                endDate: { from: vigente.endDate, to: terminated.endDate },
              }),
        },
        summary: `Contrato terminado por la baja del ${formatDateMx(fechaBaja)}`,
      },
    },
    tx,
  );

  return terminated;
};

/**
 * Baja laboral inside the caller's transaction: closes the open period with
 * fecha (≥ ingreso), tipo, motivo of the company's catalog, comentario,
 * recontratable and, optionally, the finiquito; sets people.status = baja
 * and the vigente contract to «Terminado» ending on the fecha de baja,
 * audited. terminatePerson() runs it in its own transaction; the importer
 * runs it in its batch.
 */
export const recordTermination = async (
  tx: DbTransaction,
  companyId: string,
  personId: string,
  input: TerminationValues,
  actorUserId?: string | null,
  options: TerminationOptions = {},
): Promise<TerminationResult | null> => {
  const existing = await lockPerson(tx, companyId, personId);

  if (!existing) {
    return null;
  }

  if (existing.status === "baja") {
    throw new EmploymentError("La persona ya está dada de baja.");
  }

  await syncEmploymentPeriods(tx, companyId, [personId], actorUserId);
  const periods = await listEmploymentPeriods(companyId, personId, tx);
  const open = periods.find(isOpenPeriod);

  if (!open) {
    throw new EmploymentError(
      "La persona no tiene un periodo laboral abierto.",
    );
  }

  const reason = await checkTermination(tx, companyId, open, input);
  const [period] = await tx
    .update(employmentPeriods)
    .set({
      fechaBaja: input.fechaBaja,
      tipoBaja: input.tipoBaja,
      motivoBajaId: reason.id,
      comentarioBaja: input.comentario?.trim() || null,
      recontratable: input.recontratable,
      ...finiquitoValues(input.finiquito),
    })
    .where(
      withTenant(
        employmentPeriods,
        companyId,
        eq(employmentPeriods.id, open.id),
      ),
    )
    .returning();

  const [updated] = await tx
    .update(people)
    .set({ status: "baja" })
    .where(withTenant(people, companyId, eq(people.id, personId)))
    .returning();

  const terminated = await terminateVigenteContract(
    tx,
    companyId,
    personId,
    input.fechaBaja,
    actorUserId,
    options,
  );
  const periodBefore = snapshotEmploymentPeriod(open, open.motivoBaja);
  const periodAfter = snapshotEmploymentPeriod(period, reason.name);

  await recordAuditEvent(
    {
      companyId,
      actorUserId,
      resourceType: "person",
      resourceId: personId,
      action: "baja",
      source: options.source,
      payload: {
        before: { ...snapshotPerson(existing), ...periodBefore },
        after: { ...snapshotPerson(updated), ...periodAfter },
        changes: {
          status: { from: existing.status, to: updated.status },
          ...periodChanges(periodBefore, periodAfter),
        },
        // Never the amount: the summary is not masked.
        summary: [
          `Baja laboral el ${formatDateMx(input.fechaBaja)}`,
          terminationTypeLabels[input.tipoBaja],
          reason.name,
          input.recontratable ? "recontratable" : "no recontratable",
          terminated ? "contrato terminado" : null,
        ]
          .filter(Boolean)
          .join(" · "),
      },
    },
    tx,
  );

  return { person: updated, period, contract: terminated, warnings: [] };
};

/**
 * Baja laboral in its own transaction (dialog, connector): see
 * recordTermination().
 */
export const terminatePerson = async (
  companyId: string,
  personId: string,
  input: TerminationValues,
  actorUserId?: string | null,
): Promise<TerminationResult | null> =>
  withTransaction(
    (tx) => recordTermination(tx, companyId, personId, input, actorUserId),
    companyId,
  );

/**
 * Corrects the baja of a person who is already de baja (the importer): the
 * last period takes these values under the same rules as a baja (its own
 * motivo may stay even if deactivated since). A baja
 * «sin fecha» gets its date, so the vigente contract ends on it as in a
 * baja; the period no longer needs review. Audited as an update.
 */
export const correctTermination = async (
  tx: DbTransaction,
  companyId: string,
  personId: string,
  input: TerminationValues,
  actorUserId?: string | null,
  options: TerminationOptions = {},
): Promise<TerminationResult | null> => {
  const existing = await lockPerson(tx, companyId, personId);

  if (!existing) {
    return null;
  }

  if (existing.status !== "baja") {
    throw new EmploymentError("La persona no está dada de baja.");
  }

  await syncEmploymentPeriods(tx, companyId, [personId], actorUserId);
  const last = (await listEmploymentPeriods(companyId, personId, tx)).at(-1);

  if (!last || isOpenPeriod(last)) {
    throw new EmploymentError("La persona no tiene una baja que corregir.");
  }

  const reason = await checkTermination(tx, companyId, last, input, {
    keepsMotivo: true,
  });
  const [period] = await tx
    .update(employmentPeriods)
    .set({
      fechaBaja: input.fechaBaja,
      bajaSinFecha: false,
      // An inferred date stays inferred only while nobody changes it.
      fechaBajaInferida:
        last.fechaBajaInferida && last.fechaBaja === input.fechaBaja,
      requiereRevision: false,
      tipoBaja: input.tipoBaja,
      motivoBajaId: reason.id,
      comentarioBaja: input.comentario?.trim() || null,
      recontratable: input.recontratable,
      ...finiquitoValues(input.finiquito),
    })
    .where(
      withTenant(
        employmentPeriods,
        companyId,
        eq(employmentPeriods.id, last.id),
      ),
    )
    .returning();
  const terminated = last.bajaSinFecha
    ? await terminateVigenteContract(
        tx,
        companyId,
        personId,
        input.fechaBaja,
        actorUserId,
        options,
      )
    : null;
  const before = snapshotEmploymentPeriod(last, last.motivoBaja);
  const after = snapshotEmploymentPeriod(period, reason.name);
  const changes = periodChanges(before, after);

  if (Object.keys(changes).length > 0) {
    await recordAuditEvent(
      {
        companyId,
        actorUserId,
        resourceType: "person",
        resourceId: personId,
        action: "update",
        source: options.source,
        payload: {
          before,
          after,
          changes,
          summary: [
            `Baja actualizada: ${formatDateMx(input.fechaBaja)}`,
            terminationTypeLabels[input.tipoBaja],
            reason.name,
            input.recontratable ? "recontratable" : "no recontratable",
            terminated ? "contrato terminado" : null,
          ]
            .filter(Boolean)
            .join(" · "),
        },
      },
      tx,
    );
  }

  return { person: existing, period, contract: terminated, warnings: [] };
};

/**
 * Recognizes seniority from `fecha` on the open period (the importer's
 * «Fecha de antigüedad»): reconoce_antiguedad with that date, not after the
 * ingreso. The caller audits it with the rest of the row.
 */
export const recognizeSeniority = async (
  tx: DbTransaction,
  companyId: string,
  personId: string,
  fecha: string,
) => {
  const periods = await listEmploymentPeriods(companyId, personId, tx);
  const open = periods.find(isOpenPeriod);

  if (!open) {
    throw new EmploymentError(
      "La persona no tiene un periodo laboral abierto.",
    );
  }

  if (open.fechaIngreso && fecha > open.fechaIngreso) {
    throw new EmploymentError(
      "La antigüedad reconocida no puede ser posterior al ingreso.",
      "fechaAntiguedadReconocida",
    );
  }

  const recognized = {
    reconoceAntiguedad: true,
    fechaAntiguedadReconocida: fecha,
  };
  const [period] = await tx
    .update(employmentPeriods)
    .set({
      ...recognized,
      fechaAntiguedad: seniorityDate(
        periods.map((period) =>
          period.id === open.id ? { ...period, ...recognized } : period,
        ),
      ),
    })
    .where(
      withTenant(
        employmentPeriods,
        companyId,
        eq(employmentPeriods.id, open.id),
      ),
    )
    .returning();

  return period;
};

export type RehireResult = {
  person: typeof people.$inferSelect;
  period: EmploymentPeriod;
  warnings: string[];
};

/** «La baja anterior la marcó como no recontratable», before or after a rehire. */
export const rehireWarnings = (
  last: Pick<EmploymentPeriod, "recontratable"> | null | undefined,
) =>
  last?.recontratable === false
    ? ["La baja anterior la marcó como no recontratable."]
    : [];

/**
 * Reingreso in the same expediente: the previous period must be closed; a
 * new one opens with its ingreso and the «Reconocer antigüedad previa»
 * choice (default no: seniority restarts). people.status = activa and
 * people.fecha_ingreso = the new ingreso, in the same transaction, audited.
 * Warns when the last baja said not rehirable.
 */
export const rehirePerson = async (
  companyId: string,
  personId: string,
  input: RehireValues,
  actorUserId?: string | null,
): Promise<RehireResult | null> =>
  withTransaction(async (tx) => {
    const existing = await lockPerson(tx, companyId, personId);

    if (!existing) {
      return null;
    }

    if (existing.status === "activa") {
      throw new EmploymentError("La persona ya está activa.");
    }

    await syncEmploymentPeriods(tx, companyId, [personId], actorUserId);
    const periods = await listEmploymentPeriods(companyId, personId, tx);

    if (periods.some(isOpenPeriod)) {
      throw new EmploymentError(
        "La persona ya tiene un periodo laboral abierto.",
      );
    }

    const last = periods.at(-1);

    if (last?.fechaBaja && input.fechaIngreso <= last.fechaBaja) {
      throw new EmploymentError(
        `El reingreso debe ser posterior a la baja anterior (${formatDateMx(last.fechaBaja)}).`,
        "fechaIngreso",
      );
    }

    const fresh = {
      fechaIngreso: input.fechaIngreso,
      reconoceAntiguedad: input.reconoceAntiguedad,
      fechaAntiguedadReconocida: input.reconoceAntiguedad
        ? (input.fechaAntiguedadReconocida ?? null)
        : null,
    };
    const [period] = await tx
      .insert(employmentPeriods)
      .values({
        companyId,
        personId,
        ...fresh,
        fechaAntiguedad: seniorityDate([...periods, fresh]),
        createdBy: actorUserId ?? null,
      })
      .returning()
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw new EmploymentError(
            "La persona ya tiene un periodo laboral abierto.",
          );
        }
        throw error;
      });

    const [updated] = await tx
      .update(people)
      .set({ status: "activa", fechaIngreso: input.fechaIngreso })
      .where(withTenant(people, companyId, eq(people.id, personId)))
      .returning();
    const warnings = rehireWarnings(last);
    const after = snapshotEmploymentPeriod(period);

    await recordAuditEvent(
      {
        companyId,
        actorUserId,
        resourceType: "person",
        resourceId: personId,
        action: "reingreso",
        payload: {
          before: snapshotPerson(existing),
          after: { ...snapshotPerson(updated), ...after },
          changes: {
            status: { from: existing.status, to: updated.status },
            ...(existing.fechaIngreso === updated.fechaIngreso
              ? {}
              : {
                  fechaIngreso: {
                    from: existing.fechaIngreso,
                    to: updated.fechaIngreso,
                  },
                }),
            reconoceAntiguedad: { from: null, to: period.reconoceAntiguedad },
            ...(period.fechaAntiguedadReconocida
              ? {
                  fechaAntiguedadReconocida: {
                    from: null,
                    to: period.fechaAntiguedadReconocida,
                  },
                }
              : {}),
            fechaAntiguedad: { from: null, to: period.fechaAntiguedad },
          },
          summary: [
            `Reingreso el ${formatDateMx(input.fechaIngreso)} (periodo ${periods.length + 1})`,
            period.reconoceAntiguedad
              ? `reconoce antigüedad desde ${formatDateMx(period.fechaAntiguedad ?? "")}`
              : "antigüedad desde el reingreso",
            ...warnings,
          ].join(" · "),
        },
      },
      tx,
    );

    return { person: updated, period, warnings };
  }, companyId);

/**
 * Finiquito of the last closed period, after the baja too. `monto`
 * undefined keeps the stored amount: only a user with compensation:read
 * sends it (the action and the connector enforce it).
 */
export const updateFiniquito = async (
  companyId: string,
  personId: string,
  input: FiniquitoValues,
  actorUserId?: string | null,
) =>
  withTransaction(async (tx) => {
    const existing = await lockPerson(tx, companyId, personId);

    if (!existing) {
      return null;
    }

    const [closed] = await tx
      .select(periodColumns)
      .from(employmentPeriods)
      .leftJoin(
        terminationReasons,
        and(
          eq(terminationReasons.companyId, employmentPeriods.companyId),
          eq(terminationReasons.id, employmentPeriods.motivoBajaId),
        ),
      )
      .where(
        withTenant(
          employmentPeriods,
          companyId,
          eq(employmentPeriods.personId, personId),
          or(
            isNotNull(employmentPeriods.fechaBaja),
            eq(employmentPeriods.bajaSinFecha, true),
          ),
        ),
      )
      .orderBy(
        sql`${employmentPeriods.fechaIngreso} desc nulls last`,
        sql`${employmentPeriods.createdAt} desc`,
      )
      .limit(1)
      .then((rows) => rows.map(toRow));

    if (!closed) {
      throw new EmploymentError("La persona no tiene una baja con finiquito.");
    }

    const [period] = await tx
      .update(employmentPeriods)
      .set(finiquitoValues(input))
      .where(
        withTenant(
          employmentPeriods,
          companyId,
          eq(employmentPeriods.id, closed.id),
        ),
      )
      .returning();
    const before = snapshotEmploymentPeriod(closed, closed.motivoBaja);
    const after = snapshotEmploymentPeriod(period, closed.motivoBaja);
    const changes = periodChanges(before, after);

    if (Object.keys(changes).length > 0) {
      await recordAuditEvent(
        {
          companyId,
          actorUserId,
          resourceType: "person",
          resourceId: personId,
          action: "finiquito_actualizado",
          payload: {
            before,
            after,
            changes,
            summary: `Finiquito ${period.finiquitoEstado ? finiquitoStatusLabels[period.finiquitoEstado].toLowerCase() : "sin estado"}${period.finiquitoFecha ? ` · ${formatDateMx(period.finiquitoFecha)}` : ""}`,
          },
        },
        tx,
      );
    }

    return period;
  }, companyId);
