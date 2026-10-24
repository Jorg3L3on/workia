import { and, eq, inArray, notExists, sql } from "drizzle-orm";

import { withTransaction, type DbTransaction } from "@/lib/db";
import {
  auditEvents,
  contracts,
  employmentPeriods,
  onboardings,
  people,
} from "@/lib/db/schema";

/**
 * Backfill of employment periods (migration 0025): one period per person who
 * has none, from people.fecha_ingreso (which may be null). For a person de
 * baja the fecha_baja is inferred, in this order:
 *   1. the date of the last `baja` audit event,
 *   2. the end of the last contract,
 *   3. none: a baja «sin fecha» marked for manual review.
 * Inferred dates are flagged (fecha_baja_inferida) so HR can correct them;
 * a person without ingreso is flagged for review too. Each person's altas a
 * nómina without a period are linked to it. Idempotent: people that already
 * have a period are left alone. Dry run unless `apply`.
 */
export type BackfillReport = {
  people: number;
  open: number;
  closedFromAudit: number;
  closedFromContract: number;
  closedSinFecha: number;
  sinIngreso: number;
  onboardingsLinked: number;
  applied: boolean;
};

const BATCH = 500;

type Candidate = {
  id: string;
  companyId: string;
  status: "activa" | "baja";
  fechaIngreso: string | null;
};

type PlannedPeriod = {
  values: typeof employmentPeriods.$inferInsert;
  /** Where its fecha_baja came from (open: still working). */
  source: "open" | "audit" | "contract" | "sin_fecha";
};

/** The period to insert for one person; pure, so the rule is testable alone. */
export const planEmploymentPeriod = (
  person: Candidate,
  auditBajaDate: string | null,
  lastContractEnd: string | null,
): PlannedPeriod => {
  const base = {
    companyId: person.companyId,
    personId: person.id,
    fechaIngreso: person.fechaIngreso,
    fechaAntiguedad: person.fechaIngreso,
  };

  if (person.status === "activa") {
    return {
      values: { ...base, requiereRevision: person.fechaIngreso === null },
      source: "open",
    };
  }

  // A date before the ingreso cannot be the baja (the table refuses it).
  const usable = (date: string | null) =>
    date !== null &&
    (person.fechaIngreso === null || date >= person.fechaIngreso)
      ? date
      : null;
  const fromAudit = usable(auditBajaDate);
  const fromContract = fromAudit ? null : usable(lastContractEnd);
  const fechaBaja = fromAudit ?? fromContract;

  return {
    values: {
      ...base,
      fechaBaja,
      bajaSinFecha: fechaBaja === null,
      fechaBajaInferida: fechaBaja !== null,
      requiereRevision: fechaBaja === null || person.fechaIngreso === null,
    },
    source: fromAudit ? "audit" : fromContract ? "contract" : "sin_fecha",
  };
};

const candidatesWithoutPeriods = (tx: DbTransaction, companyId?: string) =>
  tx
    .select({
      id: people.id,
      companyId: people.companyId,
      status: people.status,
      fechaIngreso: people.fechaIngreso,
    })
    .from(people)
    .where(
      and(
        companyId ? eq(people.companyId, companyId) : undefined,
        notExists(
          tx
            .select({ id: employmentPeriods.id })
            .from(employmentPeriods)
            .where(
              and(
                eq(employmentPeriods.companyId, people.companyId),
                eq(employmentPeriods.personId, people.id),
              ),
            ),
        ),
      ),
    )
    .orderBy(people.companyId, people.id);

export const backfillEmploymentPeriods = async (
  options: { apply?: boolean; companyId?: string } = {},
): Promise<BackfillReport> =>
  withTransaction(async (tx) => {
    const report: BackfillReport = {
      people: 0,
      open: 0,
      closedFromAudit: 0,
      closedFromContract: 0,
      closedSinFecha: 0,
      sinIngreso: 0,
      onboardingsLinked: 0,
      applied: Boolean(options.apply),
    };
    const candidates = await candidatesWithoutPeriods(tx, options.companyId);

    for (let start = 0; start < candidates.length; start += BATCH) {
      const batch = candidates.slice(start, start + BATCH);
      const bajaIds = batch
        .filter((person) => person.status === "baja")
        .map((person) => person.id);
      const [auditDates, contractEnds] = bajaIds.length
        ? await Promise.all([
            tx
              .select({
                personId: auditEvents.resourceId,
                companyId: auditEvents.companyId,
                // The day in Mexico City, as the app shows it.
                date: sql<string>`max((${auditEvents.occurredAt} at time zone 'America/Mexico_City')::date)::text`,
              })
              .from(auditEvents)
              .where(
                and(
                  eq(auditEvents.resourceType, "person"),
                  eq(auditEvents.action, "baja"),
                  inArray(auditEvents.resourceId, bajaIds),
                ),
              )
              .groupBy(auditEvents.resourceId, auditEvents.companyId),
            tx
              .select({
                personId: contracts.personId,
                companyId: contracts.companyId,
                date: sql<string | null>`max(${contracts.endDate})::text`,
              })
              .from(contracts)
              .where(
                and(
                  inArray(contracts.personId, bajaIds),
                  sql`${contracts.deletedAt} is null`,
                ),
              )
              .groupBy(contracts.personId, contracts.companyId),
          ])
        : [[], []];
      const key = (companyId: string, personId: string) =>
        `${companyId}:${personId}`;
      const auditBy = new Map(
        auditDates.map((row) => [key(row.companyId, row.personId), row.date]),
      );
      const contractBy = new Map(
        contractEnds.map((row) => [key(row.companyId, row.personId), row.date]),
      );
      const plans = batch.map((person) =>
        planEmploymentPeriod(
          person,
          auditBy.get(key(person.companyId, person.id)) ?? null,
          contractBy.get(key(person.companyId, person.id)) ?? null,
        ),
      );

      for (const plan of plans) {
        report.people += 1;
        if (plan.values.fechaIngreso === null) report.sinIngreso += 1;
        if (plan.source === "open") report.open += 1;
        if (plan.source === "audit") report.closedFromAudit += 1;
        if (plan.source === "contract") report.closedFromContract += 1;
        if (plan.source === "sin_fecha") report.closedSinFecha += 1;
      }

      if (!options.apply) {
        continue;
      }

      await tx
        .insert(employmentPeriods)
        .values(plans.map((plan) => plan.values));

      const linked = await tx
        .update(onboardings)
        .set({
          employmentPeriodId: sql`(select ${employmentPeriods.id} from ${employmentPeriods} where ${employmentPeriods.companyId} = ${onboardings.companyId} and ${employmentPeriods.personId} = ${onboardings.personId} limit 1)`,
        })
        .where(
          and(
            inArray(
              onboardings.personId,
              batch.map((person) => person.id),
            ),
            sql`${onboardings.employmentPeriodId} is null`,
          ),
        )
        .returning({ id: onboardings.id });
      report.onboardingsLinked += linked.length;
    }

    return report;
    // One company also works under row-level security; every company needs
    // the owner connection (as db:migrate), which the script uses.
  }, options.companyId);

/**
 * Backfill of the dimensions a closed period keeps (WRK-I12, migration 0027):
 * área, sucursal, puesto and jefe, taken from the person as they are now, for
 * closed periods (with a fecha de baja or «sin fecha») that have none yet.
 * Periods closed after 0027 got them from the domain. Idempotent: a period
 * whose values already match is left alone. Dry run unless `apply`.
 */
export const backfillTurnoverDimensions = async (
  options: { apply?: boolean; companyId?: string } = {},
): Promise<{ periods: number; applied: boolean }> =>
  withTransaction(async (tx) => {
    const pending = sql`
      ep.company_id = p.company_id and ep.person_id = p.id
      and (ep.fecha_baja is not null or ep.baja_sin_fecha)
      and ep.area_id is null and ep.site_id is null
      and ep.position_id is null and ep.manager_id is null
      and (p.area_id, p.site_id, p.position_id, p.manager_id)
        is distinct from (null::uuid, null::uuid, null::uuid, null::uuid)
      ${options.companyId ? sql`and ep.company_id = ${options.companyId}` : sql``}
    `;

    if (!options.apply) {
      const [row] = (
        await tx.execute<{ total: number }>(sql`
          select count(*)::int as total
          from ${employmentPeriods} ep, ${people} p
          where ${pending}
        `)
      ).rows;

      return { periods: row?.total ?? 0, applied: false };
    }

    const updated = await tx.execute(sql`
      update ${employmentPeriods} ep
      set area_id = p.area_id, site_id = p.site_id,
        position_id = p.position_id, manager_id = p.manager_id
      from ${people} p
      where ${pending}
    `);

    return { periods: updated.rowCount ?? 0, applied: true };
  }, options.companyId);
