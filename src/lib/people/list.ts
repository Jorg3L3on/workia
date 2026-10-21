/**
 * The Personas list and «Exportar (N)» read people through the same filter
 * (buildPeopleWhere) and the same row shape, so N is the number of rows in
 * the file. Contract, baja and payroll data only load for the columns that
 * need them, and only with the permissions the columns ask for.
 */

import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { tdb } from "@/lib/db";
import {
  areas,
  contracts,
  people,
  positions,
  regions,
  sites,
} from "@/lib/db/schema";
import type { TerminationType } from "@/lib/db/schema/employment";
import { withTenant } from "@/lib/tenant/scope";

import { listEmploymentSummaries } from "./employment";
import { terminationTypeLabels } from "./employment-schema";
import { canSeePeopleColumn, type PeopleColumnId } from "./filter/columns";
import {
  PEOPLE_FILTER_FIELDS,
  type PeopleFilterFieldId,
} from "./filter/fields";
import {
  buildPeopleWhere,
  currentPeriodValue,
  periodFlagged,
  type PeopleFilterContext,
} from "./filter/query";
import type { PeopleFilter } from "./filter/schema";
import { formatSeniority } from "./seniority";

const manager = alias(people, "manager");

export type PeopleListQuery = {
  filter: PeopleFilter;
  context: PeopleFilterContext;
  /** Visible columns; contract and payroll ones are dropped without permission. */
  columns: readonly PeopleColumnId[];
};

const rowSelection = {
  id: people.id,
  nombres: people.nombres,
  apellidoPaterno: people.apellidoPaterno,
  apellidoMaterno: people.apellidoMaterno,
  rfc: people.rfc,
  curp: people.curp,
  nss: people.nss,
  email: people.email,
  telefono: people.telefono,
  fechaIngreso: people.fechaIngreso,
  status: people.status,
  deletedAt: people.deletedAt,
  areaName: areas.name,
  positionName: positions.name,
  siteName: sites.name,
  regionName: regions.name,
  managerNombres: manager.nombres,
  managerApellidoPaterno: manager.apellidoPaterno,
  managerApellidoMaterno: manager.apellidoMaterno,
};

export type PeopleListContract = {
  type: "determinado" | "indeterminado";
  endDate: string | null;
  /** Only with compensation:read; otherwise always null. */
  salarioDiario: string | null;
  salarioMensual: string | null;
};

const selectRows = (companyId: string) =>
  tdb(companyId)
    .select(rowSelection)
    .from(people)
    .leftJoin(areas, eq(people.areaId, areas.id))
    .leftJoin(positions, eq(people.positionId, positions.id))
    .leftJoin(sites, eq(people.siteId, sites.id))
    .leftJoin(regions, eq(sites.regionId, regions.id))
    .leftJoin(manager, eq(people.managerId, manager.id));

type BaseRow = Awaited<ReturnType<typeof selectRows>>[number];

/** The current (or last) employment period, as the baja columns read it. */
export type PeopleListEmployment = {
  fechaBaja: string | null;
  tipoBaja: TerminationType | null;
  motivoBaja: string | null;
  recontratable: boolean | null;
  /** Only with compensation:read; otherwise always null. */
  finiquitoMonto: string | null;
  /** seniorityDate() of the periods; people.fecha_ingreso without periods. */
  fechaAntiguedad: string | null;
  /** «3 años, 2 meses» up to today, or up to the fecha de baja of a baja. */
  antiguedad: string | null;
};

export type PeopleListRow = BaseRow & {
  contract: PeopleListContract | null;
  employment: PeopleListEmployment | null;
};

/**
 * The contract in force on `today` of each person (the latest one if there
 * are several), with salaries only when `withPay`.
 */
const currentContracts = async (
  companyId: string,
  personIds: string[],
  today: string,
  withPay: boolean,
) => {
  if (personIds.length === 0) return new Map<string, PeopleListContract>();

  const rows = await tdb(companyId)
    .selectDistinctOn([contracts.personId], {
      personId: contracts.personId,
      type: contracts.type,
      endDate: contracts.endDate,
      salarioDiario: contracts.salarioDiario,
      salarioMensual: contracts.salarioMensual,
    })
    .from(contracts)
    .where(
      withTenant(
        contracts,
        companyId,
        inArray(contracts.personId, personIds),
        isNull(contracts.deletedAt),
        eq(contracts.status, "vigente"),
        or(
          isNull(contracts.endDate),
          sql`${contracts.endDate} >= ${today}::date`,
        ),
      ),
    )
    .orderBy(asc(contracts.personId), desc(contracts.startDate));

  return new Map(
    rows.map((row) => [
      row.personId,
      {
        type: row.type,
        endDate: row.endDate,
        salarioDiario: withPay ? row.salarioDiario : null,
        salarioMensual: withPay ? row.salarioMensual : null,
      },
    ]),
  );
};

const CONTRACT_COLUMNS: readonly PeopleColumnId[] = [
  "tipoContrato",
  "finContrato",
  "salarioDiario",
  "salarioMensual",
];

const EMPLOYMENT_COLUMNS: readonly PeopleColumnId[] = [
  "fechaBaja",
  "tipoBaja",
  "motivoBaja",
  "recontratable",
  "fechaAntiguedad",
  "antiguedad",
  "finiquitoMonto",
];

/**
 * The baja columns of each row: one batch of listEmploymentSummaries() for
 * the page (no query per person), the finiquito amount only when `withPay`.
 */
const currentEmployment = async (
  companyId: string,
  rows: BaseRow[],
  today: string,
  withPay: boolean,
) => {
  const summaries = await listEmploymentSummaries(
    companyId,
    rows.map((row) => row.id),
  );

  return new Map(
    rows.map((row) => {
      const summary = summaries.get(row.id);
      const fechaAntiguedad = summary?.fechaAntiguedad ?? row.fechaIngreso;
      // Like the constancia: a baja counts up to its fecha de baja.
      const until =
        row.status === "baja" && summary?.fechaBaja && summary.fechaBaja < today
          ? summary.fechaBaja
          : today;

      return [
        row.id,
        {
          fechaBaja: summary?.fechaBaja ?? null,
          tipoBaja: summary?.tipoBaja ?? null,
          motivoBaja: summary?.motivoBaja ?? null,
          recontratable: summary?.recontratable ?? null,
          finiquitoMonto: withPay ? (summary?.finiquitoMonto ?? null) : null,
          fechaAntiguedad,
          antiguedad: formatSeniority(fechaAntiguedad, until),
        } satisfies PeopleListEmployment,
      ];
    }),
  );
};

/** Adds the current contract and employment period when a visible column needs them. */
const withColumnData = async (
  companyId: string,
  rows: BaseRow[],
  query: PeopleListQuery,
): Promise<PeopleListRow[]> => {
  const { permissions, today } = query.context;
  const visible = query.columns.filter((id) =>
    canSeePeopleColumn(id, permissions),
  );
  const needsContract = visible.some((id) => CONTRACT_COLUMNS.includes(id));
  const needsEmployment = visible.some((id) => EMPLOYMENT_COLUMNS.includes(id));
  const withPay =
    visible.includes("salarioDiario") || visible.includes("salarioMensual");
  const [byPerson, employment] = await Promise.all([
    needsContract
      ? currentContracts(
          companyId,
          rows.map((row) => row.id),
          today,
          withPay,
        )
      : new Map<string, PeopleListContract>(),
    needsEmployment && rows.length > 0
      ? currentEmployment(
          companyId,
          rows,
          today,
          visible.includes("finiquitoMonto"),
        )
      : new Map<string, PeopleListEmployment>(),
  ]);

  return rows.map((row) => ({
    ...row,
    contract: byPerson.get(row.id) ?? null,
    employment: employment.get(row.id) ?? null,
  }));
};

/** How many people match the filter. */
export const countPeopleFiltered = async (
  companyId: string,
  filter: PeopleFilter,
  context: PeopleFilterContext,
) => {
  const [row] = await tdb(companyId)
    .select({ total: count() })
    .from(people)
    .where(buildPeopleWhere(companyId, filter, context));

  return row?.total ?? 0;
};

/** One page of the Personas list with the visible columns, plus the total. */
export const listPeopleFiltered = async (
  companyId: string,
  query: PeopleListQuery & { page: number; pageSize: number },
) => {
  const where = buildPeopleWhere(companyId, query.filter, query.context);
  const [rows, total] = await Promise.all([
    selectRows(companyId)
      .where(where)
      .orderBy(
        desc(people.updatedAt),
        asc(people.apellidoPaterno),
        asc(people.nombres),
        asc(people.id),
      )
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    countPeopleFiltered(companyId, query.filter, query.context),
  ]);

  return { rows: await withColumnData(companyId, rows, query), total };
};

/** Keyset page by id for the export: stable under edits, no OFFSET scans. */
export const listPeopleFilteredAfter = async (
  companyId: string,
  query: PeopleListQuery & { afterId?: string; limit: number },
) => {
  const rows = await selectRows(companyId)
    .where(
      and(
        buildPeopleWhere(companyId, query.filter, query.context),
        query.afterId ? gt(people.id, query.afterId) : undefined,
      ),
    )
    .orderBy(asc(people.id))
    .limit(query.limit);

  return withColumnData(companyId, rows, query);
};

/**
 * People per option of `field` under the rest of the filter («Área · Ventas
 * 12»). Only for fields marked `counts`; others get an empty map.
 */
export const countPeopleFilterOptions = async (
  companyId: string,
  filter: PeopleFilter,
  context: PeopleFilterContext,
  field: PeopleFilterFieldId,
): Promise<Record<string, number>> => {
  if (!PEOPLE_FILTER_FIELDS[field].counts) return {};

  const where = buildPeopleWhere(companyId, filter, context, { omit: field });
  const grouped = async (key: SQL | AnyPgColumn) => {
    const rows = await tdb(companyId)
      .select({ key: sql<string | null>`${key}`, total: count() })
      .from(people)
      .leftJoin(sites, eq(people.siteId, sites.id))
      .where(where)
      .groupBy(key);

    return Object.fromEntries(
      rows.flatMap((row) => (row.key ? [[row.key, row.total]] : [])),
    );
  };
  // A key of the current employment period: computed per person first, so
  // the GROUP BY does not repeat the correlated subquery. Plain SQL: the
  // RLS-scoped client cannot be nested as a subquery.
  const groupedPerPerson = async (key: SQL) => {
    const rows = await tdb(companyId)
      .select({ key: sql<string | null>`per_person.key`, total: count() })
      .from(
        sql`(select ${key} as key from ${people} where ${where}) per_person`,
      )
      .groupBy(sql`per_person.key`);

    return Object.fromEntries(
      rows.flatMap((row) => (row.key ? [[row.key, row.total]] : [])),
    );
  };

  switch (field) {
    case "relacion":
      return grouped(sql`${people.status}::text`);
    case "area":
      return grouped(people.areaId);
    case "puesto":
      return grouped(people.positionId);
    case "sucursal":
      return grouped(people.siteId);
    case "region":
      return grouped(sites.regionId);
    case "incompletos": {
      const [row] = await tdb(companyId)
        .select({
          curp: sql<number>`count(*) filter (where coalesce(${people.curp}, '') = '')::int`,
          nss: sql<number>`count(*) filter (where coalesce(${people.nss}, '') = '')::int`,
          rfc: sql<number>`count(*) filter (where coalesce(${people.rfc}, '') = '')::int`,
        })
        .from(people)
        .where(where);

      return row ?? {};
    }
    case "tipoBaja":
      return groupedPerPerson(
        currentPeriodValue(companyId, sql`ep.tipo_baja::text`),
      );
    case "motivoBaja":
      return groupedPerPerson(
        currentPeriodValue(companyId, sql`ep.motivo_baja_id::text`),
      );
    case "recontratable":
      return groupedPerPerson(
        sql`case ${currentPeriodValue(companyId, sql`ep.recontratable`)} when true then 'si' when false then 'no' end`,
      );
    case "revisionBaja": {
      const flagged = (flag: string) =>
        sql<number>`count(*) filter (where ${periodFlagged(companyId, flag)})::int`;
      const [row] = await tdb(companyId)
        .select({
          sin_fecha: flagged("sin_fecha"),
          inferida: flagged("inferida"),
          revision: flagged("revision"),
        })
        .from(people)
        .where(where);

      return row ?? {};
    }
    default:
      return {};
  }
};

/** Names of people of the company by id (the labels of a Jefe chip). */
export const listPeopleNamesByIds = async (
  companyId: string,
  ids: readonly string[],
) =>
  ids.length === 0
    ? []
    : tdb(companyId)
        .select({
          id: people.id,
          nombres: people.nombres,
          apellidoPaterno: people.apellidoPaterno,
          apellidoMaterno: people.apellidoMaterno,
        })
        .from(people)
        .where(withTenant(people, companyId, inArray(people.id, [...ids])));

const contractTypeLabel: Record<string, string> = {
  determinado: "Determinado",
  indeterminado: "Indeterminado",
};
const statusLabel: Record<string, string> = { activa: "Activa", baja: "Baja" };
const yesNo = (value: boolean | null | undefined) =>
  value === true ? "Sí" : value === false ? "No" : null;

/**
 * The raw value of a column for a row: ISO dates, plain amounts, labels for
 * enums. The table formats dates and amounts; the export writes them as is
 * (dates as dd/mm/aaaa, like the rest of the file).
 */
export const peopleColumnValue = (
  row: PeopleListRow,
  id: PeopleColumnId,
): string | null => {
  switch (id) {
    case "rfc":
      return row.rfc;
    case "curp":
      return row.curp;
    case "nss":
      return row.nss;
    case "email":
      return row.email;
    case "telefono":
      return row.telefono;
    case "ingreso":
      return row.fechaIngreso;
    case "area":
      return row.areaName;
    case "puesto":
      return row.positionName;
    case "sucursal":
      return row.siteName;
    case "region":
      return row.regionName;
    case "jefe":
      return row.managerNombres
        ? [
            row.managerNombres,
            row.managerApellidoPaterno,
            row.managerApellidoMaterno,
          ]
            .filter(Boolean)
            .join(" ")
        : null;
    case "relacion":
      return statusLabel[row.status] ?? row.status;
    case "tipoContrato":
      return row.contract
        ? (contractTypeLabel[row.contract.type] ?? row.contract.type)
        : null;
    case "finContrato":
      return row.contract?.endDate ?? null;
    case "salarioDiario":
      return row.contract?.salarioDiario ?? null;
    case "salarioMensual":
      return row.contract?.salarioMensual ?? null;
    case "fechaBaja":
      return row.employment?.fechaBaja ?? null;
    case "tipoBaja": {
      const tipo = row.employment?.tipoBaja;
      return tipo ? terminationTypeLabels[tipo] : null;
    }
    case "motivoBaja":
      return row.employment?.motivoBaja ?? null;
    case "recontratable":
      return yesNo(row.employment?.recontratable);
    case "fechaAntiguedad":
      return row.employment?.fechaAntiguedad ?? null;
    case "antiguedad":
      return row.employment?.antiguedad ?? null;
    case "finiquitoMonto":
      return row.employment?.finiquitoMonto ?? null;
    default:
      return null;
  }
};
