import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import {
  buildChanges,
  recordAuditEvent,
  snapshotContract,
  snapshotContractTemplate,
} from "@/lib/audit";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/tenant/scope";
import { areas, contractTemplates, contracts, people } from "@/lib/db/schema";
import type { ContractStatus } from "@/lib/db/schema/contracts";
import { getPersonWithRelations } from "@/lib/people";
import { formatHorarioToken, formatPersonName } from "@/lib/people/schema";
import { siteKindLabels } from "@/lib/sites/schema";

import type {
  ContractFormValues,
  ContractTemplateFormValues,
  RenewContractFormValues,
} from "./schema";
import { buildContractScheduleSnapshot, fillContractTemplate } from "./schema";

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
) => {
  const person = await getPersonWithRelations(companyId, personId);

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
    },
  };
};

export const listActiveContractTemplates = async (companyId: string) =>
  db
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

  return db
    .select()
    .from(contractTemplates)
    .where(and(...filters))
    .orderBy(asc(contractTemplates.name));
};

export const getContractTemplateById = async (
  companyId: string,
  id: string,
) => {
  const [template] = await db
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
  const [created] = await db
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

  const [updated] = await db
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

  const [updated] = await db
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

  const [updated] = await db
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
  db
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

export const getContractById = async (companyId: string, id: string) => {
  const [contract] = await db
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
  const [contract] = await db
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
): Promise<RenewalTrayItem[]> => {
  const query = db
    .select({
      contractId: contracts.id,
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
    .where(renewalTrayWhere(companyId, referenceDate))
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
  }));
};

export const countRenewalTrayItems = async (
  companyId: string,
  referenceDate?: string,
) => {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contracts)
    .innerJoin(people, eq(contracts.personId, people.id))
    .where(renewalTrayWhere(companyId, referenceDate));

  return row?.count ?? 0;
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
  },
  actorUserId: string,
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
  );

  const generatedText = fillContractTemplate(template.body, context);
  const scheduleSnapshot = buildContractScheduleSnapshot(person.schedule);

  const [created] = await db
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
    })
    .returning();

  await recordAuditEvent({
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
  });

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
    },
    actorUserId,
  );
};

export const renewContract = async (
  companyId: string,
  input: RenewContractFormValues,
  actorUserId: string,
) => {
  const existing = await getContractById(companyId, input.contractId);

  if (!existing || existing.status !== "vigente") {
    throw new Error("Contrato no encontrado o ya no está vigente.");
  }

  const endDate = normalizeEndDate(input.type, input.endDate);

  const [updatedPrevious] = await db
    .update(contracts)
    .set({ status: "renovado" })
    .where(withTenant(contracts, companyId, eq(contracts.id, existing.id)))
    .returning();

  await recordAuditEvent({
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
  });

  return emitContractRecord(
    companyId,
    {
      personId: existing.personId,
      type: input.type,
      startDate: input.startDate,
      endDate,
      noticeWindow: input.noticeWindow,
      templateId: input.templateId,
      previousContractId: existing.id,
    },
    actorUserId,
  );
};

export const markContractNoRenew = async (
  companyId: string,
  contractId: string,
  actorUserId: string,
) => {
  const existing = await getContractById(companyId, contractId);

  if (!existing || existing.status !== "vigente") {
    throw new Error("Contrato no encontrado o ya no está vigente.");
  }

  const [updated] = await db
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
      summary: "Decisión: no renovar contrato",
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

  const [updated] = await db
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
