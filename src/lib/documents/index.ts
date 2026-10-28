import { and, asc, desc, eq, isNull } from "drizzle-orm";

import {
  buildChanges,
  recordAuditEvent,
  snapshotDocumentRequirement,
  snapshotPersonDocument,
} from "@/lib/audit";
import { tdb, withTransaction, type DbExecutor } from "@/lib/db";
import { isUniqueViolation, rethrowDuplicate } from "@/lib/db/errors";
import {
  documentRequirements,
  people,
  personDocuments,
  positions,
} from "@/lib/db/schema";
import { formatPersonName } from "@/lib/people/schema";
import { withTenant } from "@/lib/tenant/scope";

import {
  selectExpiringDocumentRows,
  type ExpiringDocumentQuery,
} from "./expiring";
import {
  buildPersonDocumentCard,
  personDocumentCardWithoutPosition,
} from "./person-card";
import {
  addCalendarMonths,
  DEFAULT_DOCUMENT_REQUIREMENTS,
  requirementNameKey,
  type RecordDeliveryInput,
  type SetRequirementsInput,
} from "./schema";

/**
 * Document requirements and delivery dates (WRK-I15-1). Reading needs
 * documents:read; defining requirements and recording a date needs
 * documents:manage. Those checks live in the actions. Every query here
 * filters by company_id.
 */

const positionScope = (positionId: string | null) =>
  positionId === null
    ? isNull(documentRequirements.positionId)
    : eq(documentRequirements.positionId, positionId);

const listLiveInScope = async (
  companyId: string,
  positionId: string | null,
  executor: DbExecutor,
) =>
  executor
    .select()
    .from(documentRequirements)
    .where(
      withTenant(
        documentRequirements,
        companyId,
        isNull(documentRequirements.deletedAt),
        positionScope(positionId),
      ),
    )
    .orderBy(asc(documentRequirements.sort), asc(documentRequirements.name));

/** Two first activations raced past the existence check. */
export class DocumentsAlreadyActiveError extends Error {
  constructor(message = "El módulo de documentos ya está activo.") {
    super(message);
    this.name = "DocumentsAlreadyActiveError";
  }
}

/**
 * Copies the alta checklist (names only) the first time the company
 * activates the module. A company that already has any requirement, even a
 * deleted one, is left as it is. Constancia fiscal and cuenta bancaria are
 * stored with required = false.
 *
 * The action that exposes this must call requireDocumentsManage first.
 * Two first activations at once can both pass the existence check; the
 * second hits the unique name index and is thrown as
 * DocumentsAlreadyActiveError, not the raw database error.
 */
export const activateDocumentRequirements = async (
  companyId: string,
  actorUserId?: string | null,
) => {
  try {
    return await withTransaction(async (tx) => {
      const [existing] = await tx
        .select({ id: documentRequirements.id })
        .from(documentRequirements)
        .where(eq(documentRequirements.companyId, companyId))
        .limit(1);

      if (!existing) {
        const created = await tx
          .insert(documentRequirements)
          .values(
            DEFAULT_DOCUMENT_REQUIREMENTS.map((item) => ({
              companyId,
              positionId: null,
              name: item.name,
              required: item.required,
              validityMonths: null,
              sort: item.sort,
              active: true,
            })),
          )
          .returning();

        for (const row of created) {
          await recordAuditEvent(
            {
              companyId,
              actorUserId,
              resourceType: "document_requirement",
              resourceId: row.id,
              action: "create",
              payload: {
                after: snapshotDocumentRequirement(row),
                summary: `Requisito de documento creado: ${row.name}`,
              },
            },
            tx,
          );
        }
      }

      return listLiveInScope(companyId, null, tx);
    }, companyId);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DocumentsAlreadyActiveError();
    }

    throw error;
  }
};

export const listDocumentRequirements = async (
  companyId: string,
  options: { positionId?: string | null; activeOnly?: boolean } = {},
) => {
  const positionFilter =
    options.positionId === undefined
      ? undefined
      : positionScope(options.positionId);

  return tdb(companyId)
    .select()
    .from(documentRequirements)
    .where(
      withTenant(
        documentRequirements,
        companyId,
        isNull(documentRequirements.deletedAt),
        positionFilter,
        options.activeOnly ? eq(documentRequirements.active, true) : undefined,
      ),
    )
    .orderBy(asc(documentRequirements.sort), asc(documentRequirements.name));
};

export const getDocumentRequirementById = async (
  companyId: string,
  id: string,
) => {
  const [row] = await tdb(companyId)
    .select()
    .from(documentRequirements)
    .where(
      withTenant(
        documentRequirements,
        companyId,
        eq(documentRequirements.id, id),
      ),
    )
    .limit(1);

  return row ?? null;
};

export const listPersonDocuments = async (
  companyId: string,
  personId: string,
) =>
  tdb(companyId)
    .select()
    .from(personDocuments)
    .where(
      withTenant(
        personDocuments,
        companyId,
        eq(personDocuments.personId, personId),
      ),
    )
    .orderBy(
      desc(personDocuments.deliveredOn),
      desc(personDocuments.createdAt),
    );

/**
 * Replaces the live requirements of one scope. An id or a position that is
 * not in this company returns null and writes nothing. Names not in the list
 * are soft-deleted; deliveries already recorded keep pointing at them.
 */
export const setRequirements = async (
  companyId: string,
  input: SetRequirementsInput,
  actorUserId?: string | null,
) =>
  withTransaction(async (tx) => {
    if (input.positionId) {
      const [position] = await tx
        .select({ id: positions.id })
        .from(positions)
        .where(
          withTenant(
            positions,
            companyId,
            eq(positions.id, input.positionId),
            isNull(positions.deletedAt),
          ),
        )
        .limit(1);

      if (!position) {
        return null;
      }
    }

    const existing = await listLiveInScope(companyId, input.positionId, tx);
    const byId = new Map(existing.map((row) => [row.id, row]));
    const claimed = new Set<string>();
    const plan: Array<{
      item: SetRequirementsInput["requirements"][number];
      current: (typeof existing)[number] | null;
    }> = [];

    for (const item of input.requirements) {
      if (item.id) {
        const current = byId.get(item.id);

        if (!current || claimed.has(current.id)) {
          return null;
        }

        claimed.add(current.id);
        plan.push({ item, current });
        continue;
      }

      const current = existing.find(
        (row) =>
          !claimed.has(row.id) &&
          requirementNameKey(row.name) === requirementNameKey(item.name),
      );

      if (current) {
        claimed.add(current.id);
      }

      plan.push({ item, current: current ?? null });
    }

    for (const row of existing) {
      if (claimed.has(row.id)) {
        continue;
      }

      const [updated] = await tx
        .update(documentRequirements)
        .set({ deletedAt: new Date() })
        .where(
          withTenant(
            documentRequirements,
            companyId,
            eq(documentRequirements.id, row.id),
            isNull(documentRequirements.deletedAt),
          ),
        )
        .returning();

      if (!updated) {
        continue;
      }

      await recordAuditEvent(
        {
          companyId,
          actorUserId,
          resourceType: "document_requirement",
          resourceId: row.id,
          action: "delete",
          payload: {
            before: snapshotDocumentRequirement(row),
            after: snapshotDocumentRequirement(updated),
            summary: `Requisito de documento borrado lógicamente: ${row.name}`,
          },
        },
        tx,
      );
    }

    for (const { item, current } of plan) {
      if (!current) {
        const [created] = await tx
          .insert(documentRequirements)
          .values({
            companyId,
            positionId: input.positionId,
            name: item.name,
            required: item.required,
            validityMonths: item.validityMonths,
            sort: item.sort,
            active: item.active,
          })
          .returning()
          .catch(
            rethrowDuplicate("Ya existe un requisito activo con ese nombre."),
          );

        await recordAuditEvent(
          {
            companyId,
            actorUserId,
            resourceType: "document_requirement",
            resourceId: created.id,
            action: "create",
            payload: {
              after: snapshotDocumentRequirement(created),
              summary: `Requisito de documento creado: ${created.name}`,
            },
          },
          tx,
        );
        continue;
      }

      const [updated] = await tx
        .update(documentRequirements)
        .set({
          name: item.name,
          required: item.required,
          validityMonths: item.validityMonths,
          sort: item.sort,
          active: item.active,
        })
        .where(
          withTenant(
            documentRequirements,
            companyId,
            eq(documentRequirements.id, current.id),
          ),
        )
        .returning()
        .catch(
          rethrowDuplicate("Ya existe un requisito activo con ese nombre."),
        );

      if (!updated) {
        throw new Error("No se pudo actualizar el requisito.");
      }

      const before = snapshotDocumentRequirement(current);
      const after = snapshotDocumentRequirement(updated);
      const changes = buildChanges(before, after, [
        "name",
        "required",
        "validityMonths",
        "sort",
        "active",
      ]);

      if (Object.keys(changes).length > 0) {
        await recordAuditEvent(
          {
            companyId,
            actorUserId,
            resourceType: "document_requirement",
            resourceId: current.id,
            action: "update",
            payload: {
              before,
              after,
              changes,
              summary: `Requisito de documento editado: ${updated.name}`,
            },
          },
          tx,
        );
      }
    }

    return listLiveInScope(companyId, input.positionId, tx);
  }, companyId);

/**
 * Records a delivery date for a person and a requirement of the same company.
 * Returns null when either id is not in the company, the requirement is
 * inactive, or it belongs to another position. expiresOn omitted is filled
 * from validity_months; null means the paper does not expire.
 */
export const recordDelivery = async (
  companyId: string,
  input: RecordDeliveryInput,
  actorUserId?: string | null,
) =>
  withTransaction(async (tx) => {
    const [person] = await tx
      .select({
        id: people.id,
        positionId: people.positionId,
        deletedAt: people.deletedAt,
      })
      .from(people)
      .where(withTenant(people, companyId, eq(people.id, input.personId)))
      .limit(1);

    if (!person || person.deletedAt) {
      return null;
    }

    const [requirement] = await tx
      .select()
      .from(documentRequirements)
      .where(
        withTenant(
          documentRequirements,
          companyId,
          eq(documentRequirements.id, input.requirementId),
        ),
      )
      .limit(1);

    if (!requirement || requirement.deletedAt || !requirement.active) {
      return null;
    }

    if (
      requirement.positionId &&
      requirement.positionId !== person.positionId
    ) {
      return null;
    }

    const expiresOn =
      input.expiresOn !== undefined
        ? input.expiresOn
        : requirement.validityMonths
          ? addCalendarMonths(input.deliveredOn, requirement.validityMonths)
          : null;

    const [created] = await tx
      .insert(personDocuments)
      .values({
        companyId,
        personId: person.id,
        requirementId: requirement.id,
        deliveredOn: input.deliveredOn,
        expiresOn,
        createdBy: actorUserId ?? null,
      })
      .returning();

    await recordAuditEvent(
      {
        companyId,
        actorUserId,
        resourceType: "person_document",
        resourceId: created.id,
        action: "create",
        payload: {
          after: snapshotPersonDocument(created),
          summary: `Documento registrado: ${requirement.name}`,
        },
      },
      tx,
    );

    return created;
  }, companyId);

/**
 * Rows for the expediente card: active requirements of the person's puesto,
 * with the latest delivery of each. Returns null when the person is not in
 * this company (the page turns that into 404). A person with no puesto is
 * an empty card, not a missing person.
 */
export const listPersonDocumentCard = async (
  companyId: string,
  personId: string,
  today: string,
) => {
  const [person] = await tdb(companyId)
    .select({ id: people.id, positionId: people.positionId })
    .from(people)
    .where(withTenant(people, companyId, eq(people.id, personId)))
    .limit(1);

  if (!person) {
    return null;
  }

  if (!person.positionId) {
    return personDocumentCardWithoutPosition();
  }

  const [requirements, deliveries] = await Promise.all([
    listDocumentRequirements(companyId, {
      positionId: person.positionId,
      activeOnly: true,
    }),
    listPersonDocuments(companyId, person.id),
  ]);

  return buildPersonDocumentCard(requirements, deliveries, today);
};

/**
 * The tray and `list_expiring_documents`: every latest delivery in this
 * company that expires today or within 30 days (`status` expiring), or that
 * is already expired when `status` is expired. `today` is `isoToday()`.
 * Another company's rows never match the company filter.
 */
export const listExpiringDocuments = async (
  companyId: string,
  today: string,
  options: ExpiringDocumentQuery = {},
) => {
  const rows = await tdb(companyId)
    .select({
      id: personDocuments.id,
      personId: personDocuments.personId,
      requirementId: personDocuments.requirementId,
      deliveredOn: personDocuments.deliveredOn,
      expiresOn: personDocuments.expiresOn,
      createdAt: personDocuments.createdAt,
      nombres: people.nombres,
      apellidoPaterno: people.apellidoPaterno,
      apellidoMaterno: people.apellidoMaterno,
      positionId: people.positionId,
      positionName: positions.name,
      requirementName: documentRequirements.name,
    })
    .from(personDocuments)
    .innerJoin(
      people,
      and(
        eq(people.companyId, personDocuments.companyId),
        eq(people.id, personDocuments.personId),
        isNull(people.deletedAt),
      ),
    )
    .innerJoin(
      documentRequirements,
      and(
        eq(documentRequirements.companyId, personDocuments.companyId),
        eq(documentRequirements.id, personDocuments.requirementId),
        isNull(documentRequirements.deletedAt),
        eq(documentRequirements.active, true),
      ),
    )
    .leftJoin(
      positions,
      and(
        eq(positions.companyId, personDocuments.companyId),
        eq(positions.id, people.positionId),
        isNull(positions.deletedAt),
      ),
    )
    .where(withTenant(personDocuments, companyId));

  return selectExpiringDocumentRows(
    rows.map((row) => ({
      id: row.id,
      personId: row.personId,
      requirementId: row.requirementId,
      deliveredOn: row.deliveredOn,
      expiresOn: row.expiresOn,
      createdAt: row.createdAt,
      personName: formatPersonName(row),
      positionId: row.positionId,
      positionName: row.positionName,
      requirementName: row.requirementName,
    })),
    today,
    options,
  );
};
