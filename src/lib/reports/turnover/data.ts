import { and, asc, eq, isNull } from "drizzle-orm";

import { buildChanges, recordAuditEvent } from "@/lib/audit";
import { tdb } from "@/lib/db";
import {
  areas,
  companies,
  employmentPeriods,
  people,
  positions,
  sites,
  terminationReasons,
} from "@/lib/db/schema";
import { formatPersonName } from "@/lib/people/schema";
import { withTenant } from "@/lib/tenant/scope";

import type { TurnoverLabels } from "./labels";
import type { TurnoverFact } from "./schema";

/**
 * Every employment period of the company's live expedientes, as the turnover
 * report reads them (WRK-I12). Scoped by company explicitly (row-level
 * security is not on in production). A closed period reports the área,
 * sucursal, puesto and jefe it froze when it closed (migration 0027); one
 * closed before that and not backfilled yet falls back to the person's
 * current ones, as an open period does.
 */
export const loadTurnoverFacts = async (
  companyId: string,
): Promise<TurnoverFact[]> => {
  const rows = await tdb(companyId)
    .select({
      id: employmentPeriods.id,
      personId: employmentPeriods.personId,
      nombres: people.nombres,
      apellidoPaterno: people.apellidoPaterno,
      apellidoMaterno: people.apellidoMaterno,
      fechaIngreso: employmentPeriods.fechaIngreso,
      fechaBaja: employmentPeriods.fechaBaja,
      bajaSinFecha: employmentPeriods.bajaSinFecha,
      fechaBajaInferida: employmentPeriods.fechaBajaInferida,
      requiereRevision: employmentPeriods.requiereRevision,
      tipoBaja: employmentPeriods.tipoBaja,
      motivoId: employmentPeriods.motivoBajaId,
      motivoName: terminationReasons.name,
      motivoClassification: terminationReasons.classification,
      recontratable: employmentPeriods.recontratable,
      createdAt: employmentPeriods.createdAt,
      frozen: {
        areaId: employmentPeriods.areaId,
        siteId: employmentPeriods.siteId,
        positionId: employmentPeriods.positionId,
        managerId: employmentPeriods.managerId,
      },
      current: {
        areaId: people.areaId,
        siteId: people.siteId,
        positionId: people.positionId,
        managerId: people.managerId,
      },
    })
    .from(employmentPeriods)
    .innerJoin(
      people,
      and(
        eq(people.companyId, employmentPeriods.companyId),
        eq(people.id, employmentPeriods.personId),
        isNull(people.deletedAt),
      ),
    )
    .leftJoin(
      terminationReasons,
      and(
        eq(terminationReasons.companyId, employmentPeriods.companyId),
        eq(terminationReasons.id, employmentPeriods.motivoBajaId),
      ),
    )
    .where(withTenant(employmentPeriods, companyId))
    .orderBy(
      asc(employmentPeriods.personId),
      asc(employmentPeriods.fechaIngreso),
      asc(employmentPeriods.createdAt),
    );

  return rows.map((row, index) => {
    const closed = row.fechaBaja !== null || row.bajaSinFecha;
    const hasFrozen = Object.values(row.frozen).some((value) => value !== null);
    const previous = index > 0 ? rows[index - 1] : null;
    const samePerson = previous?.personId === row.personId;

    return {
      id: row.id,
      personId: row.personId,
      personName: formatPersonName(row),
      fechaIngreso: row.fechaIngreso,
      fechaBaja: row.fechaBaja,
      bajaSinFecha: row.bajaSinFecha,
      fechaBajaInferida: row.fechaBajaInferida,
      requiereRevision: row.requiereRevision,
      tipoBaja: row.tipoBaja,
      motivoId: row.motivoId,
      motivoName: row.motivoName,
      motivoClassification: row.motivoClassification,
      recontratable: row.recontratable,
      ...(closed && hasFrozen ? row.frozen : row.current),
      firstOfPerson: !samePerson,
      previousRecontratable: samePerson ? previous!.recontratable : null,
      hasLaterPeriod: rows[index + 1]?.personId === row.personId,
    } satisfies TurnoverFact;
  });
};

/**
 * Names for the report's groups and filters. Deleted catalog rows keep their
 * name: history may still point at them.
 */
export const loadTurnoverLabels = async (
  companyId: string,
): Promise<TurnoverLabels> => {
  const [areaRows, siteRows, positionRows, personRows] = await Promise.all([
    tdb(companyId)
      .select({ id: areas.id, name: areas.name })
      .from(areas)
      .where(withTenant(areas, companyId)),
    tdb(companyId)
      .select({ id: sites.id, name: sites.name })
      .from(sites)
      .where(withTenant(sites, companyId)),
    tdb(companyId)
      .select({ id: positions.id, name: positions.name })
      .from(positions)
      .where(withTenant(positions, companyId)),
    tdb(companyId)
      .select({
        id: people.id,
        managerId: people.managerId,
        nombres: people.nombres,
        apellidoPaterno: people.apellidoPaterno,
        apellidoMaterno: people.apellidoMaterno,
      })
      .from(people)
      .where(withTenant(people, companyId)),
  ]);
  const names = (rows: { id: string; name: string }[]) =>
    Object.fromEntries(rows.map((row) => [row.id, row.name]));
  const managerIds = new Set(
    personRows.map((row) => row.managerId).filter(Boolean),
  );
  const reportsOf: Record<string, string[]> = {};

  for (const row of personRows) {
    if (row.managerId) (reportsOf[row.managerId] ??= []).push(row.id);
  }

  return {
    areas: names(areaRows),
    sites: names(siteRows),
    positions: names(positionRows),
    managers: Object.fromEntries(
      personRows
        .filter((row) => managerIds.has(row.id))
        .map((row) => [row.id, formatPersonName(row)]),
    ),
    reportsOf,
  };
};

/** The company's monthly turnover goal in %, or null when it has none. */
export const getTurnoverGoal = async (companyId: string) => {
  const [row] = await tdb(companyId)
    .select({ goal: companies.turnoverGoalPct })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  return row?.goal === null || row?.goal === undefined
    ? null
    : Number(row.goal);
};

/** Sets (or clears, with null) the monthly turnover goal; audited. */
export const setTurnoverGoal = async (
  companyId: string,
  goal: number | null,
  actorUserId?: string | null,
) => {
  const before = await getTurnoverGoal(companyId);
  const [updated] = await tdb(companyId)
    .update(companies)
    .set({ turnoverGoalPct: goal === null ? null : goal.toFixed(2) })
    .where(eq(companies.id, companyId))
    .returning({ id: companies.id });

  if (!updated) return null;

  if (before !== goal) {
    await recordAuditEvent({
      companyId,
      actorUserId,
      resourceType: "company",
      resourceId: companyId,
      action: "update",
      payload: {
        before: { turnoverGoalPct: before },
        after: { turnoverGoalPct: goal },
        changes: buildChanges(
          { turnoverGoalPct: before },
          { turnoverGoalPct: goal },
          ["turnoverGoalPct"],
        ),
        summary:
          goal === null
            ? "Meta de rotación quitada"
            : `Meta de rotación: ${goal}% mensual`,
      },
    });
  }

  return { goal };
};
