import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";

import {
  buildChanges,
  recordAuditEvent,
  snapshotContract,
  snapshotContractTemplate,
} from "@/lib/audit";
import { tdb, withTransaction, type DbExecutor } from "@/lib/db";
import { withTenant } from "@/lib/tenant/scope";
import {
  areas,
  contractTemplates,
  contracts,
  people,
  sites,
} from "@/lib/db/schema";
import type { ContractStatus } from "@/lib/db/schema/contracts";
import { getPersonWithRelations, personInRegion } from "@/lib/people";
import {
  formatHorarioToken,
  formatMexicanAddress,
  formatPersonName,
  maritalStatusLabels,
} from "@/lib/people/schema";
import { siteKindLabels } from "@/lib/sites/schema";
import { formatSeniority } from "@/lib/people/seniority";
import { getCompanyById } from "@/lib/tenant/companies";

import { OFFICIAL_TEMPLATES } from "./official-templates";

import type {
  ContractFormValues,
  ContractTemplateFormValues,
  RenewContractFormValues,
} from "./schema";
import {
  buildContractScheduleSnapshot,
  compensationValues,
  type CompensationValues,
  CONTRACT_TEMPLATE_TOKENS,
  contractStatusLabels,
  contractTypeLabels,
  fillContractTemplate,
  formatContractDate,
  templateTokenValues,
  type ContractTemplateToken,
  type TemplateFillContext,
} from "./schema";

const normalizeEndDate = (
  type: ContractFormValues["type"],
  endDate?: string,
) => (type === "indeterminado" ? null : (endDate?.trim() ?? null));

const buildSiteLabel = (
  site?: { name: string; kind: "corporativo" | "sucursal" } | null,
) => {
  if (!site) {
    return "";
  }

  return `${site.name} (${siteKindLabels[site.kind]})`;
};

const resolveTemplateFillContext = async (
  companyId: string,
  personId: string,
  startDate: string,
  endDate: string | null,
  compensation?: CompensationValues | null,
) => {
  const [person, company] = await Promise.all([
    getPersonWithRelations(companyId, personId),
    getCompanyById(companyId),
  ]);

  if (!person) {
    throw new Error("Persona no encontrada.");
  }

  return {
    person,
    context: {
      nombres: person.nombres,
      apellidoPaterno: person.apellidoPaterno,
      apellidoMaterno: person.apellidoMaterno,
      puesto: person.position?.name ?? null,
      area: person.area?.name ?? null,
      sucursal: buildSiteLabel(person.site),
      rfc: person.rfc,
      horario: formatHorarioToken(person.schedule),
      fechaInicio: startDate,
      fechaFin: endDate,
      // Official templates (WRK-I5-5).
      curp: person.curp,
      nss: person.nss,
      ine: person.ineClaveElector,
      domicilio: formatMexicanAddress(person),
      estadoCivil: person.estadoCivil
        ? maritalStatusLabels[person.estadoCivil]
        : null,
      nacionalidad: person.nacionalidad,
      salarioDiario: compensation?.salarioDiario ?? null,
      salarioMensual: compensation?.salarioMensual ?? null,
      formaPago: compensation?.formaPago ?? null,
      periodicidad: compensation?.periodicidadPago ?? null,
      fechaIngreso: person.fechaIngreso,
      empresa: company?.name ?? null,
      empresaRazonSocial: company?.legalName ?? null,
      empresaRfc: company?.rfc ?? null,
    } satisfies TemplateFillContext,
  };
};

export const listActiveContractTemplates = async (companyId: string) =>
  tdb(companyId)
    .select()
    .from(contractTemplates)
    .where(
      withTenant(
        contractTemplates,
        companyId,
        isNull(contractTemplates.deletedAt),
        eq(contractTemplates.active, true),
      ),
    )
    .orderBy(asc(contractTemplates.name));

export const listContractTemplates = async (
  companyId: string,
  includeInactive = false,
) => {
  const filters = [
    eq(contractTemplates.companyId, companyId),
    isNull(contractTemplates.deletedAt),
  ];

  if (!includeInactive) {
    filters.push(eq(contractTemplates.active, true));
  }

  return tdb(companyId)
    .select()
    .from(contractTemplates)
    .where(and(...filters))
    .orderBy(asc(contractTemplates.name));
};

export const getContractTemplateById = async (
  companyId: string,
  id: string,
) => {
  const [template] = await tdb(companyId)
    .select()
    .from(contractTemplates)
    .where(
      withTenant(
        contractTemplates,
        companyId,
        eq(contractTemplates.id, id),
        isNull(contractTemplates.deletedAt),
      ),
    )
    .limit(1);

  return template ?? null;
};

export const createContractTemplate = async (
  companyId: string,
  input: ContractTemplateFormValues,
  actorUserId: string,
) => {
  const [created] = await tdb(companyId)
    .insert(contractTemplates)
    .values({
      companyId,
      name: input.name.trim(),
      body: input.body.trim(),
      active: input.active,
    })
    .returning();

  await recordAuditEvent({
    companyId,
    actorUserId,
    resourceType: "contract_template",
    resourceId: created.id,
    action: "create",
    payload: {
      summary: `Plantilla creada: ${created.name}`,
      after: snapshotContractTemplate(created),
    },
  });

  return created;
};

/**
 * Adds the base official templates to the company (WRK-I5-5), skipping any
 * whose name it already has; returns the ones it created.
 */
export const addOfficialTemplates = async (
  companyId: string,
  actorUserId: string,
) => {
  const existing = new Set(
    (await listContractTemplates(companyId, true)).map((template) =>
      template.name.trim().toLowerCase(),
    ),
  );
  const created = [];

  for (const template of OFFICIAL_TEMPLATES) {
    if (existing.has(template.name.toLowerCase())) continue;

    created.push(
      await createContractTemplate(
        companyId,
        { name: template.name, body: template.body, active: true },
        actorUserId,
      ),
    );
  }

  return created;
};

export const updateContractTemplate = async (
  companyId: string,
  id: string,
  input: ContractTemplateFormValues,
  actorUserId: string,
) => {
  const existing = await getContractTemplateById(companyId, id);

  if (!existing) {
    throw new Error("Plantilla no encontrada.");
  }

  const [updated] = await tdb(companyId)
    .update(contractTemplates)
    .set({
      name: input.name.trim(),
      body: input.body.trim(),
      active: input.active,
    })
    .where(
      withTenant(contractTemplates, companyId, eq(contractTemplates.id, id)),
    )
    .returning();

  await recordAuditEvent({
    companyId,
    actorUserId,
    resourceType: "contract_template",
    resourceId: id,
    action: "update",
    payload: {
      summary: `Plantilla actualizada: ${updated.name}`,
      before: snapshotContractTemplate(existing),
      after: snapshotContractTemplate(updated),
      changes: buildChanges(
        snapshotContractTemplate(existing),
        snapshotContractTemplate(updated),
        ["name", "body", "active"],
      ),
    },
  });

  return updated;
};

export const deactivateContractTemplate = async (
  companyId: string,
  id: string,
  actorUserId: string,
) => {
  const existing = await getContractTemplateById(companyId, id);

  if (!existing) {
    throw new Error("Plantilla no encontrada.");
  }

  const [updated] = await tdb(companyId)
    .update(contractTemplates)
    .set({ active: false })
    .where(
      withTenant(contractTemplates, companyId, eq(contractTemplates.id, id)),
    )
    .returning();

  await recordAuditEvent({
    companyId,
    actorUserId,
    resourceType: "contract_template",
    resourceId: id,
    action: "deactivate",
    payload: {
      summary: `Plantilla desactivada: ${existing.name}`,
      before: snapshotContractTemplate(existing),
      after: snapshotContractTemplate(updated),
    },
  });

  return updated;
};

export const softDeleteContractTemplate = async (
  companyId: string,
  id: string,
  actorUserId: string,
) => {
  const existing = await getContractTemplateById(companyId, id);

  if (!existing) {
    throw new Error("Plantilla no encontrada.");
  }

  const deletedAt = new Date();

  const [updated] = await tdb(companyId)
    .update(contractTemplates)
    .set({ active: false, deletedAt })
    .where(
      withTenant(contractTemplates, companyId, eq(contractTemplates.id, id)),
    )
    .returning();

  await recordAuditEvent({
    companyId,
    actorUserId,
    resourceType: "contract_template",
    resourceId: id,
    action: "delete",
    payload: {
      summary: `Plantilla eliminada: ${existing.name}`,
      before: snapshotContractTemplate(existing),
      after: snapshotContractTemplate(updated),
    },
  });

  return updated;
};

export const listContractsByPerson = async (
  companyId: string,
  personId: string,
) =>
  tdb(companyId)
    .select()
    .from(contracts)
    .where(
      withTenant(
        contracts,
        companyId,
        eq(contracts.personId, personId),
        isNull(contracts.deletedAt),
      ),
    )
    .orderBy(desc(contracts.startDate), desc(contracts.createdAt));

/**
 * Seniority certificate of a person (WRK-I5-5): original hire date, seniority
 * as of a date and the chain of contracts, plus the same content as text (the
 * connector returns it). Null for a person outside the company.
 */
export const getSeniorityCertificate = async (
  companyId: string,
  personId: string,
  asOf: string,
) => {
  const [person, company, chain] = await Promise.all([
    getPersonWithRelations(companyId, personId, true),
    getCompanyById(companyId),
    listContractsByPerson(companyId, personId),
  ]);

  if (!person) {
    return null;
  }

  const contratos = [...chain]
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .map((contract) => ({
      id: contract.id,
      type: contract.type,
      status: contract.status,
      startDate: contract.startDate,
      endDate: contract.endDate,
    }));
  const name = formatPersonName(person);
  const antiguedad = formatSeniority(person.fechaIngreso, asOf);
  const companyName = company?.legalName || company?.name || "La empresa";
  const text = [
    "CONSTANCIA DE ANTIGÜEDAD",
    "",
    `${companyName}${company?.rfc ? `, con RFC ${company.rfc},` : ""} hace constar que ${name}${person.curp ? ` (CURP ${person.curp})` : ""} ${person.fechaIngreso ? `ingresó a laborar el ${formatContractDate(person.fechaIngreso)} y al ${formatContractDate(asOf)} cuenta con una antigüedad de ${antiguedad ?? "menos de un mes"}` : "no tiene fecha de ingreso capturada"}${person.position?.name ? `, con el puesto de ${person.position.name}` : ""}.`,
    "",
    contratos.length > 0 ? "Contratos:" : "Sin contratos registrados.",
    ...contratos.map(
      (contract, index) =>
        `${index + 1}. ${contractTypeLabels[contract.type]} del ${formatContractDate(contract.startDate)}${contract.endDate ? ` al ${formatContractDate(contract.endDate)}` : ""} (${contractStatusLabels[contract.status]})`,
    ),
    "",
    `Se extiende la presente el ${formatContractDate(asOf)}.`,
  ].join("\n");

  return {
    person,
    company,
    fechaIngreso: person.fechaIngreso,
    antiguedad,
    asOf,
    contratos,
    text,
  };
};

export const getContractById = async (companyId: string, id: string) => {
  const [contract] = await tdb(companyId)
    .select()
    .from(contracts)
    .where(
      withTenant(
        contracts,
        companyId,
        eq(contracts.id, id),
        isNull(contracts.deletedAt),
      ),
    )
    .limit(1);

  return contract ?? null;
};

export const getVigenteContractForPerson = async (
  companyId: string,
  personId: string,
) => {
  const [contract] = await tdb(companyId)
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
    .limit(1);

  return contract ?? null;
};

export type RenewalTrayItem = {
  contract: Pick<
    typeof contracts.$inferSelect,
    "id" | "endDate" | "noticeWindow"
  >;
  personName: string;
  personId: string;
  areaName: string | null;
  endDate: string;
  noticeWindow: typeof contracts.$inferSelect.noticeWindow;
  /** Only when asked for (compensation:read): prefills the renewal (WRK-I5-2). */
  compensation?: CompensationValues;
};

// Notice window in months, as SQL; null for "no_avisar".
const noticeMonthsSql = sql<number | null>`case ${contracts.noticeWindow}
  when 'no_avisar' then null
  else substring(${contracts.noticeWindow}::text from '^[0-9]+')::int
end`;

const renewalTrayWhere = (companyId: string, referenceDate?: string) => {
  const today = referenceDate ? sql`${referenceDate}::date` : sql`current_date`;

  return and(
    eq(contracts.companyId, companyId),
    eq(contracts.status, "vigente"),
    eq(contracts.type, "determinado"),
    isNull(contracts.deletedAt),
    isNull(people.deletedAt),
    isNotNull(contracts.endDate),
    sql`${noticeMonthsSql} is not null`,
    sql`${today} >= (${contracts.endDate}::date - (${noticeMonthsSql} * interval '1 month'))::date`,
    sql`${today} <= ${contracts.endDate}::date`,
  );
};

/** Renewal tray in one query (people + areas joined, window filtered in SQL). */
export const listRenewalTrayItems = async (
  companyId: string,
  referenceDate?: string,
  limit?: number,
  options: { compensation?: boolean; regionId?: string } = {},
): Promise<RenewalTrayItem[]> => {
  const query = tdb(companyId)
    .select({
      contractId: contracts.id,
      salarioDiario: contracts.salarioDiario,
      salarioMensual: contracts.salarioMensual,
      formaPago: contracts.formaPago,
      periodicidadPago: contracts.periodicidadPago,
      diaPago: contracts.diaPago,
      endDate: contracts.endDate,
      noticeWindow: contracts.noticeWindow,
      personId: people.id,
      nombres: people.nombres,
      apellidoPaterno: people.apellidoPaterno,
      apellidoMaterno: people.apellidoMaterno,
      areaName: areas.name,
    })
    .from(contracts)
    .innerJoin(people, eq(contracts.personId, people.id))
    .leftJoin(areas, eq(people.areaId, areas.id))
    .where(
      and(
        renewalTrayWhere(companyId, referenceDate),
        options.regionId
          ? personInRegion(companyId, options.regionId)
          : undefined,
      ),
    )
    .orderBy(asc(contracts.endDate));

  const rows = await (limit ? query.limit(limit) : query);

  return rows.map((row) => ({
    contract: {
      id: row.contractId,
      endDate: row.endDate,
      noticeWindow: row.noticeWindow,
    },
    personName: formatPersonName({
      nombres: row.nombres,
      apellidoPaterno: row.apellidoPaterno,
      apellidoMaterno: row.apellidoMaterno,
    }),
    personId: row.personId,
    areaName: row.areaName ?? null,
    endDate: row.endDate!,
    noticeWindow: row.noticeWindow,
    ...(options.compensation
      ? {
          compensation: {
            salarioDiario: row.salarioDiario,
            salarioMensual: row.salarioMensual,
            formaPago: row.formaPago,
            periodicidadPago: row.periodicidadPago,
            diaPago: row.diaPago,
          },
        }
      : {}),
  }));
};

export const countRenewalTrayItems = async (
  companyId: string,
  referenceDate?: string,
) => {
  const [row] = await tdb(companyId)
    .select({ count: sql<number>`count(*)::int` })
    .from(contracts)
    .innerJoin(people, eq(contracts.personId, people.id))
    .where(renewalTrayWhere(companyId, referenceDate));

  return row?.count ?? 0;
};

/** Everything an emission reads first: the template, the person and the filled text. */
const prepareContractRecord = async (
  companyId: string,
  input: {
    personId: string;
    startDate: string;
    endDate: string | null;
    templateId: string;
    compensation?: CompensationValues;
  },
) => {
  const template = await getContractTemplateById(companyId, input.templateId);

  if (!template) {
    throw new Error("Plantilla no encontrada.");
  }

  const { person, context } = await resolveTemplateFillContext(
    companyId,
    input.personId,
    input.startDate,
    input.endDate,
    input.compensation,
  );

  return {
    template,
    generatedText: fillContractTemplate(template.body, context),
    scheduleSnapshot: buildContractScheduleSnapshot(person.schedule),
  };
};

const emitContractRecord = async (
  companyId: string,
  input: {
    personId: string;
    type: ContractFormValues["type"];
    startDate: string;
    endDate: string | null;
    noticeWindow: ContractFormValues["noticeWindow"];
    templateId: string;
    previousContractId?: string | null;
    status?: ContractStatus;
    compensation?: CompensationValues;
  },
  actorUserId: string,
  prepared?: Awaited<ReturnType<typeof prepareContractRecord>>,
  executor: DbExecutor = tdb(companyId),
) => {
  const { template, generatedText, scheduleSnapshot } =
    prepared ?? (await prepareContractRecord(companyId, input));

  const [created] = await executor
    .insert(contracts)
    .values({
      companyId,
      personId: input.personId,
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate,
      noticeWindow: input.noticeWindow,
      templateId: template.id,
      templateName: template.name,
      generatedText,
      ...scheduleSnapshot,
      status: input.status ?? "vigente",
      previousContractId: input.previousContractId ?? null,
      ...(input.compensation ?? {}),
    })
    .returning();

  await recordAuditEvent(
    {
      companyId,
      actorUserId,
      resourceType: "contract",
      resourceId: created.id,
      action: input.previousContractId ? "renew" : "create",
      payload: {
        summary: input.previousContractId
          ? "Contrato renovado"
          : "Contrato emitido",
        after: snapshotContract(created),
      },
    },
    executor,
  );

  return created;
};

export const createContract = async (
  companyId: string,
  input: ContractFormValues,
  actorUserId: string,
) => {
  const endDate = normalizeEndDate(input.type, input.endDate);

  const vigente = await getVigenteContractForPerson(companyId, input.personId);

  if (vigente) {
    throw new Error("Esta persona ya tiene un contrato vigente.");
  }

  return emitContractRecord(
    companyId,
    {
      personId: input.personId,
      type: input.type,
      startDate: input.startDate,
      endDate,
      noticeWindow: input.noticeWindow,
      templateId: input.templateId,
      compensation: compensationValues(input),
    },
    actorUserId,
  );
};

/** Thrown inside the renewal transaction when the contract stopped being vigente. */
export class ContractNotVigenteError extends Error {
  constructor() {
    super("Contrato no encontrado o ya no está vigente.");
    this.name = "ContractNotVigenteError";
  }
}

/**
 * Marks the contract «renovado» and emits the new one in one transaction
 * (WRK-I1-5): if the emission fails, the previous contract stays vigente.
 */
export const renewContract = async (
  companyId: string,
  input: RenewContractFormValues,
  actorUserId: string,
) => {
  const existing = await getContractById(companyId, input.contractId);

  if (!existing || existing.status !== "vigente") {
    throw new ContractNotVigenteError();
  }

  const endDate = normalizeEndDate(input.type, input.endDate);
  const next = {
    personId: existing.personId,
    type: input.type,
    startDate: input.startDate,
    endDate,
    noticeWindow: input.noticeWindow,
    templateId: input.templateId,
    previousContractId: existing.id,
    // Not sent (the form hid it from someone without compensation:read):
    // the renewal keeps the previous contract's compensation.
    compensation:
      input.salarioDiario === undefined
        ? {
            salarioDiario: existing.salarioDiario,
            salarioMensual: existing.salarioMensual,
            formaPago: existing.formaPago,
            periodicidadPago: existing.periodicidadPago,
            diaPago: existing.diaPago,
          }
        : compensationValues(input),
  };
  // Reads happen before the transaction; only the writes go inside it.
  const prepared = await prepareContractRecord(companyId, next);

  return withTransaction(async (tx) => {
    const [updatedPrevious] = await tx
      .update(contracts)
      .set({ status: "renovado" })
      .where(
        withTenant(
          contracts,
          companyId,
          eq(contracts.id, existing.id),
          // Two renewals racing: only one finds it still vigente.
          eq(contracts.status, "vigente"),
        ),
      )
      .returning();

    if (!updatedPrevious) {
      throw new ContractNotVigenteError();
    }

    await recordAuditEvent(
      {
        companyId,
        actorUserId,
        resourceType: "contract",
        resourceId: existing.id,
        action: "renew",
        payload: {
          summary: "Contrato anterior marcado como renovado",
          before: snapshotContract(existing),
          after: snapshotContract(updatedPrevious),
        },
      },
      tx,
    );

    return emitContractRecord(companyId, next, actorUserId, prepared, tx);
  }, companyId);
};

export const markContractNoRenew = async (
  companyId: string,
  contractId: string,
  actorUserId: string,
  /** Why not; kept in the audit summary until P5 gives it a column. */
  motivo?: string,
) => {
  const existing = await getContractById(companyId, contractId);

  if (!existing || existing.status !== "vigente") {
    throw new Error("Contrato no encontrado o ya no está vigente.");
  }

  const [updated] = await tdb(companyId)
    .update(contracts)
    .set({ status: "no_renovado" })
    .where(withTenant(contracts, companyId, eq(contracts.id, contractId)))
    .returning();

  await recordAuditEvent({
    companyId,
    actorUserId,
    resourceType: "contract",
    resourceId: contractId,
    action: "no_renew",
    payload: {
      summary: motivo?.trim()
        ? `Decisión: no renovar contrato · Motivo: ${motivo.trim()}`
        : "Decisión: no renovar contrato",
      before: snapshotContract(existing),
      after: snapshotContract(updated),
    },
  });

  return updated;
};

export const softDeleteContract = async (
  companyId: string,
  contractId: string,
  actorUserId: string,
) => {
  const existing = await getContractById(companyId, contractId);

  if (!existing) {
    throw new Error("Contrato no encontrado.");
  }

  const deletedAt = new Date();

  const [updated] = await tdb(companyId)
    .update(contracts)
    .set({
      deletedAt,
      status: existing.status === "vigente" ? "vencido" : existing.status,
    })
    .where(withTenant(contracts, companyId, eq(contracts.id, contractId)))
    .returning();

  await recordAuditEvent({
    companyId,
    actorUserId,
    resourceType: "contract",
    resourceId: contractId,
    action: "delete",
    payload: {
      summary: "Contrato eliminado del expediente",
      before: snapshotContract(existing),
      after: snapshotContract(updated),
    },
  });

  return updated;
};

export type ListContractsKeysetOptions = {
  personId?: string;
  statuses?: ContractStatus[];
  type?: ContractFormValues["type"];
  endDateFrom?: string;
  endDateTo?: string;
  /** Keyset position: after (end date, or 9999-12-31 when open-ended; id). */
  after?: { key: string; id: string } | null;
  limit: number;
};

/** Sort key of a contract: its end date, or the far future for indeterminados. */
export const contractEndSortKey = sql<string>`coalesce(${contracts.endDate}, '9999-12-31'::date)::text`;

const personNameColumns = {
  personId: people.id,
  nombres: people.nombres,
  apellidoPaterno: people.apellidoPaterno,
  apellidoMaterno: people.apellidoMaterno,
};

/**
 * Contracts with filters in a stable order (end date, id) for cursor paging,
 * without the generated text. Read only; used by the MCP list_contracts.
 */
export const listContractsKeyset = async (
  companyId: string,
  options: ListContractsKeysetOptions,
) => {
  const filters = [
    eq(contracts.companyId, companyId),
    isNull(contracts.deletedAt),
    options.personId ? eq(contracts.personId, options.personId) : undefined,
    options.statuses?.length
      ? inArray(contracts.status, options.statuses)
      : undefined,
    options.type ? eq(contracts.type, options.type) : undefined,
    options.endDateFrom
      ? sql`${contracts.endDate} >= ${options.endDateFrom}::date`
      : undefined,
    options.endDateTo
      ? sql`${contracts.endDate} <= ${options.endDateTo}::date`
      : undefined,
    options.after
      ? sql`(coalesce(${contracts.endDate}, '9999-12-31'::date), ${contracts.id}) > (${options.after.key}::date, ${options.after.id}::uuid)`
      : undefined,
  ];

  return tdb(companyId)
    .select({
      id: contracts.id,
      type: contracts.type,
      status: contracts.status,
      startDate: contracts.startDate,
      endDate: contracts.endDate,
      noticeWindow: contracts.noticeWindow,
      templateName: contracts.templateName,
      previousContractId: contracts.previousContractId,
      sortKey: contractEndSortKey,
      ...personNameColumns,
    })
    .from(contracts)
    .innerJoin(people, eq(contracts.personId, people.id))
    .where(and(...filters))
    .orderBy(
      sql`coalesce(${contracts.endDate}, '9999-12-31'::date)`,
      asc(contracts.id),
    )
    .limit(options.limit + 1);
};

/**
 * Determinado contracts in force ending between `today` and `today + withinDays`
 * (whatever the notice window), with area and site. Read only.
 */
export const listExpiringContracts = async (
  companyId: string,
  options: {
    today: string;
    withinDays: number;
    siteId?: string;
    regionId?: string;
    areaId?: string;
    after?: { key: string; id: string } | null;
    limit: number;
  },
) => {
  const filters = [
    eq(contracts.companyId, companyId),
    eq(contracts.status, "vigente"),
    eq(contracts.type, "determinado"),
    isNull(contracts.deletedAt),
    isNull(people.deletedAt),
    sql`${contracts.endDate} >= ${options.today}::date`,
    sql`${contracts.endDate} <= ${options.today}::date + ${options.withinDays}::int`,
    options.siteId ? eq(people.siteId, options.siteId) : undefined,
    options.regionId ? personInRegion(companyId, options.regionId) : undefined,
    options.areaId ? eq(people.areaId, options.areaId) : undefined,
    options.after
      ? sql`(${contracts.endDate}, ${contracts.id}) > (${options.after.key}::date, ${options.after.id}::uuid)`
      : undefined,
  ];

  return tdb(companyId)
    .select({
      id: contracts.id,
      endDate: contracts.endDate,
      noticeWindow: contracts.noticeWindow,
      status: contracts.status,
      type: contracts.type,
      areaName: areas.name,
      siteName: sites.name,
      ...personNameColumns,
    })
    .from(contracts)
    .innerJoin(people, eq(contracts.personId, people.id))
    .leftJoin(areas, eq(people.areaId, areas.id))
    .leftJoin(sites, eq(people.siteId, sites.id))
    .where(and(...filters))
    .orderBy(asc(contracts.endDate), asc(contracts.id))
    .limit(options.limit + 1);
};

/** Tokens a template uses, in order of first appearance. */
export const templateTokensUsed = (body: string) => [
  ...new Set(
    [...body.matchAll(/\{\{(\w+)\}\}/g)]
      .map((match) => match[1])
      .filter((token): token is ContractTemplateToken =>
        (CONTRACT_TEMPLATE_TOKENS as readonly string[]).includes(token),
      ),
  ),
];

/**
 * Dry run of issuing a contract: the text the template would produce, the
 * tokens that would come out empty and what would block it. Saves nothing.
 */
export const previewContract = async (
  companyId: string,
  input: {
    personId: string;
    templateId: string;
    type: ContractFormValues["type"];
    startDate: string;
    endDate?: string;
    /** The compensation the contract would freeze, for its tokens. */
    compensation?: CompensationValues;
  },
) => {
  const template = await getContractTemplateById(companyId, input.templateId);

  if (!template) {
    return null;
  }

  const endDate = normalizeEndDate(input.type, input.endDate);
  const { person, context } = await resolveTemplateFillContext(
    companyId,
    input.personId,
    input.startDate,
    endDate,
    input.compensation,
  ).catch(() => ({ person: null, context: null }));

  if (!person || !context) {
    return null;
  }

  const values = templateTokenValues(context);
  const missingTokens = templateTokensUsed(template.body).filter(
    (token) => values[token] === null,
  );
  const blocking: string[] = [];

  if (await getVigenteContractForPerson(companyId, input.personId)) {
    blocking.push("Esta persona ya tiene un contrato vigente.");
  }

  if (input.type === "determinado" && !endDate) {
    blocking.push("Un contrato determinado necesita fecha de fin.");
  }

  if (person.status !== "activa") {
    blocking.push("La persona está dada de baja.");
  }

  return {
    person,
    template,
    generatedText: fillContractTemplate(template.body, context),
    missingTokens,
    blocking,
    scheduleSnapshot: buildContractScheduleSnapshot(person.schedule),
  };
};
