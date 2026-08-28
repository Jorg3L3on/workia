import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import {
  buildChanges,
  recordAuditEvent,
  snapshotContract,
  snapshotContractTemplate,
} from "@/lib/audit";
import { db } from "@/lib/db";
import { contractTemplates, contracts, people } from "@/lib/db/schema";
import type { ContractStatus } from "@/lib/db/schema/contracts";
import { getPersonWithRelations } from "@/lib/people";
import { formatPersonName } from "@/lib/people/schema";
import { siteKindLabels } from "@/lib/sites/schema";

import type {
  ContractFormValues,
  ContractTemplateFormValues,
  RenewContractFormValues,
} from "./schema";
import { fillContractTemplate, isContractInRenewalWindow } from "./schema";

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
  personId: string,
  startDate: string,
  endDate: string | null,
) => {
  const person = await getPersonWithRelations(personId);

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
      fechaInicio: startDate,
      fechaFin: endDate,
    },
  };
};

export const listActiveContractTemplates = async () =>
  db
    .select()
    .from(contractTemplates)
    .where(
      and(
        isNull(contractTemplates.deletedAt),
        eq(contractTemplates.active, true),
      ),
    )
    .orderBy(asc(contractTemplates.name));

export const listContractTemplates = async (includeInactive = false) => {
  const filters = [isNull(contractTemplates.deletedAt)];

  if (!includeInactive) {
    filters.push(eq(contractTemplates.active, true));
  }

  return db
    .select()
    .from(contractTemplates)
    .where(filters.length === 1 ? filters[0] : and(...filters))
    .orderBy(asc(contractTemplates.name));
};

export const getContractTemplateById = async (id: string) => {
  const [template] = await db
    .select()
    .from(contractTemplates)
    .where(
      and(eq(contractTemplates.id, id), isNull(contractTemplates.deletedAt)),
    )
    .limit(1);

  return template ?? null;
};

export const createContractTemplate = async (
  input: ContractTemplateFormValues,
  actorUserId: string,
) => {
  const [created] = await db
    .insert(contractTemplates)
    .values({
      name: input.name.trim(),
      body: input.body.trim(),
      active: input.active,
    })
    .returning();

  await recordAuditEvent({
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
  id: string,
  input: ContractTemplateFormValues,
  actorUserId: string,
) => {
  const existing = await getContractTemplateById(id);

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
    .where(eq(contractTemplates.id, id))
    .returning();

  await recordAuditEvent({
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
  id: string,
  actorUserId: string,
) => {
  const existing = await getContractTemplateById(id);

  if (!existing) {
    throw new Error("Plantilla no encontrada.");
  }

  const [updated] = await db
    .update(contractTemplates)
    .set({ active: false })
    .where(eq(contractTemplates.id, id))
    .returning();

  await recordAuditEvent({
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
  id: string,
  actorUserId: string,
) => {
  const existing = await getContractTemplateById(id);

  if (!existing) {
    throw new Error("Plantilla no encontrada.");
  }

  const deletedAt = new Date();

  const [updated] = await db
    .update(contractTemplates)
    .set({ active: false, deletedAt })
    .where(eq(contractTemplates.id, id))
    .returning();

  await recordAuditEvent({
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

export const listContractsByPerson = async (personId: string) =>
  db
    .select()
    .from(contracts)
    .where(and(eq(contracts.personId, personId), isNull(contracts.deletedAt)))
    .orderBy(desc(contracts.startDate), desc(contracts.createdAt));

export const getContractById = async (id: string) => {
  const [contract] = await db
    .select()
    .from(contracts)
    .where(and(eq(contracts.id, id), isNull(contracts.deletedAt)))
    .limit(1);

  return contract ?? null;
};

export const getVigenteContractForPerson = async (personId: string) => {
  const [contract] = await db
    .select()
    .from(contracts)
    .where(
      and(
        eq(contracts.personId, personId),
        eq(contracts.status, "vigente"),
        isNull(contracts.deletedAt),
      ),
    )
    .limit(1);

  return contract ?? null;
};

export type RenewalTrayItem = {
  contract: typeof contracts.$inferSelect;
  personName: string;
  personId: string;
  areaName: string | null;
  endDate: string;
  noticeWindow: typeof contracts.$inferSelect.noticeWindow;
};

export const listRenewalTrayItems = async (
  referenceDate?: string,
): Promise<RenewalTrayItem[]> => {
  const rows = await db
    .select({
      contract: contracts,
      nombres: people.nombres,
      apellidoPaterno: people.apellidoPaterno,
      apellidoMaterno: people.apellidoMaterno,
      personId: people.id,
      areaName: sql<string | null>`null`,
    })
    .from(contracts)
    .innerJoin(people, eq(contracts.personId, people.id))
    .where(
      and(
        eq(contracts.status, "vigente"),
        eq(contracts.type, "determinado"),
        isNull(contracts.deletedAt),
        isNull(people.deletedAt),
      ),
    )
    .orderBy(asc(contracts.endDate));

  const personIds = [...new Set(rows.map((row) => row.personId))];
  const peopleWithRelations = await Promise.all(
    personIds.map((id) => getPersonWithRelations(id)),
  );
  const areaByPerson = new Map(
    peopleWithRelations
      .filter(Boolean)
      .map((person) => [person!.id, person!.area?.name ?? null]),
  );

  return rows
    .filter((row) =>
      isContractInRenewalWindow({
        type: row.contract.type,
        status: row.contract.status,
        endDate: row.contract.endDate,
        noticeWindow: row.contract.noticeWindow,
        referenceDate,
      }),
    )
    .map((row) => ({
      contract: row.contract,
      personName: formatPersonName({
        nombres: row.nombres,
        apellidoPaterno: row.apellidoPaterno,
        apellidoMaterno: row.apellidoMaterno,
      }),
      personId: row.personId,
      areaName: areaByPerson.get(row.personId) ?? null,
      endDate: row.contract.endDate!,
      noticeWindow: row.contract.noticeWindow,
    }));
};

export const countRenewalTrayItems = async (referenceDate?: string) => {
  const items = await listRenewalTrayItems(referenceDate);
  return items.length;
};

const emitContractRecord = async (
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
  const template = await getContractTemplateById(input.templateId);

  if (!template) {
    throw new Error("Plantilla no encontrada.");
  }

  const { context } = await resolveTemplateFillContext(
    input.personId,
    input.startDate,
    input.endDate,
  );

  const generatedText = fillContractTemplate(template.body, context);

  const [created] = await db
    .insert(contracts)
    .values({
      personId: input.personId,
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate,
      noticeWindow: input.noticeWindow,
      templateId: template.id,
      templateName: template.name,
      generatedText,
      status: input.status ?? "vigente",
      previousContractId: input.previousContractId ?? null,
    })
    .returning();

  await recordAuditEvent({
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
  input: ContractFormValues,
  actorUserId: string,
) => {
  const endDate = normalizeEndDate(input.type, input.endDate);

  const vigente = await getVigenteContractForPerson(input.personId);

  if (vigente) {
    throw new Error("Esta persona ya tiene un contrato vigente.");
  }

  return emitContractRecord(
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
  input: RenewContractFormValues,
  actorUserId: string,
) => {
  const existing = await getContractById(input.contractId);

  if (!existing || existing.status !== "vigente") {
    throw new Error("Contrato no encontrado o ya no está vigente.");
  }

  const endDate = normalizeEndDate(input.type, input.endDate);

  const [updatedPrevious] = await db
    .update(contracts)
    .set({ status: "renovado" })
    .where(eq(contracts.id, existing.id))
    .returning();

  await recordAuditEvent({
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
  contractId: string,
  actorUserId: string,
) => {
  const existing = await getContractById(contractId);

  if (!existing || existing.status !== "vigente") {
    throw new Error("Contrato no encontrado o ya no está vigente.");
  }

  const [updated] = await db
    .update(contracts)
    .set({ status: "no_renovado" })
    .where(eq(contracts.id, contractId))
    .returning();

  await recordAuditEvent({
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
  contractId: string,
  actorUserId: string,
) => {
  const existing = await getContractById(contractId);

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
    .where(eq(contracts.id, contractId))
    .returning();

  await recordAuditEvent({
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
