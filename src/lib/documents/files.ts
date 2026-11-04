import { randomUUID } from "node:crypto";

import { and, asc, count, eq, isNull } from "drizzle-orm";

import { recordAuditEvent, snapshotPersonDocument } from "@/lib/audit";
import { tdb, withTransaction, type DbExecutor } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/errors";
import {
  documentRequirements,
  people,
  personDocuments,
  positions,
} from "@/lib/db/schema";
import type { EmployeeContext } from "@/lib/employee-accounts/sign-in";
import { logger } from "@/lib/logger";
import { formatPersonName } from "@/lib/people/schema";
import {
  pendingPrivacyNotice,
  getCurrentPrivacyNotice,
  recordPersonalDataAccess,
} from "@/lib/privacy";
import {
  createNotifications,
  personRecipient,
  sendNotificationsSoon,
} from "@/lib/notifications";
import { getObjectStorage, objectKey } from "@/lib/storage";
import { appendPersonEvents } from "@/lib/timeline";
import { documentEvent } from "@/lib/timeline/events";
import { withTenant } from "@/lib/tenant/scope";

import { listPersonDocumentCard } from "./index";
import {
  DOCUMENT_FILE_MAX_BYTES,
  DOCUMENT_FILE_TYPES,
  DOCUMENT_FILES_COPY,
  documentRejectionReasonLabels,
  sniffDocumentFileType,
  type ReviewDocumentInput,
} from "./files-schema";
import { addCalendarMonths } from "./schema";

/**
 * Document files and HR review (W2-04). An employee uploads the file of a
 * requirement of their puesto; the row is status "uploaded" and does not
 * count yet. HR accepts it (it becomes the delivery, with the same expiry
 * rule as recordDelivery) or rejects it with a reason from a closed list,
 * which deletes the file. Files live in object storage (src/lib/storage),
 * never in Neon, and every signed URL writes the personal data access log.
 */

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

// ---------------------------------------------------------------- employee

/** Why an employee cannot upload right now, or null when they can. */
export const employeeUploadBlocker = async (context: EmployeeContext) => {
  if (!getObjectStorage()) return DOCUMENT_FILES_COPY.noStorage;
  if (!(await getCurrentPrivacyNotice(context.companyId))) {
    return DOCUMENT_FILES_COPY.noNotice;
  }
  if (await pendingPrivacyNotice(context.companyId, context.personId)) {
    return DOCUMENT_FILES_COPY.noticePending;
  }
  return null;
};

/**
 * The employee's «Mis documentos»: the same rows as HR's expediente card
 * (requirements of their puesto, latest accepted delivery, pending or
 * rejected upload). Read with the session's company and person only.
 */
export const listEmployeeDocuments = async (
  context: EmployeeContext,
  today: string,
) => listPersonDocumentCard(context.companyId, context.personId, today);

export type UploadDocumentFile = {
  bytes: Uint8Array;
};

/**
 * Stores the file, then the "uploaded" row and its audit event. The file
 * type comes from its first bytes. A second upload while one is pending is
 * refused (one pending row per person and requirement, enforced by an index).
 */
export const uploadEmployeeDocument = async (
  context: EmployeeContext,
  input: { requirementId: string; file: UploadDocumentFile; today: string },
): Promise<Result<{ id: string }>> => {
  const { companyId, personId } = context;
  const blocker = await employeeUploadBlocker(context);
  if (blocker) return { ok: false, error: blocker };

  const size = input.file.bytes.byteLength;
  if (size === 0) return { ok: false, error: DOCUMENT_FILES_COPY.empty };
  if (size > DOCUMENT_FILE_MAX_BYTES) {
    return { ok: false, error: DOCUMENT_FILES_COPY.tooLarge };
  }
  const contentType = sniffDocumentFileType(input.file.bytes);
  if (!contentType) return { ok: false, error: DOCUMENT_FILES_COPY.badType };

  const card = await listPersonDocumentCard(companyId, personId, input.today);
  const row = card?.rows.find((r) => r.requirementId === input.requirementId);
  if (!row) return { ok: false, error: DOCUMENT_FILES_COPY.notRequired };
  if (row.review?.status === "uploaded") {
    return { ok: false, error: DOCUMENT_FILES_COPY.pending };
  }

  const storage = getObjectStorage()!;
  const id = randomUUID();
  const key = objectKey({
    companyId,
    area: "documents",
    segments: [personId, id],
    ext: DOCUMENT_FILE_TYPES[contentType],
  });

  await storage.put(key, input.file.bytes, contentType);

  try {
    await withTransaction(async (tx) => {
      const [created] = await tx
        .insert(personDocuments)
        .values({
          id,
          companyId,
          personId,
          requirementId: input.requirementId,
          deliveredOn: input.today,
          expiresOn: null,
          status: "uploaded",
          fileKey: key,
          fileContentType: contentType,
          fileSize: size,
          uploadedByAccountId: context.accountId,
        })
        .returning();

      await recordAuditEvent(
        {
          companyId,
          actorEmployeeAccountId: context.accountId,
          source: "employee",
          resourceType: "person_document",
          resourceId: created.id,
          action: "create",
          payload: {
            after: { ...snapshotPersonDocument(created), status: "uploaded" },
            summary: `Documento subido para revisión: ${row.name}`,
          },
        },
        tx,
      );
      // W2-13: the upload is on the person's timeline, in the same commit.
      await appendPersonEvents(
        companyId,
        [
          documentEvent(created, "employee_app", "uploaded", {
            occurredAt: created.createdAt,
          }),
        ],
        tx,
      );
    }, companyId);
  } catch (error) {
    await storage.delete(key).catch(() => undefined);
    if (isUniqueViolation(error)) {
      return { ok: false, error: DOCUMENT_FILES_COPY.pending };
    }
    throw error;
  }

  return { ok: true, value: { id } };
};

// ---------------------------------------------------------------- files

const fileName = (requirementName: string, contentType: string) => {
  const ext =
    DOCUMENT_FILE_TYPES[contentType as keyof typeof DOCUMENT_FILE_TYPES] ??
    "bin";
  return `${requirementName}.${ext}`;
};

const findDocumentFile = async (
  companyId: string,
  documentId: string,
  personId: string | null,
  executor: DbExecutor = tdb(companyId),
) => {
  const [row] = await executor
    .select({
      id: personDocuments.id,
      personId: personDocuments.personId,
      fileKey: personDocuments.fileKey,
      fileContentType: personDocuments.fileContentType,
      requirementName: documentRequirements.name,
    })
    .from(personDocuments)
    .innerJoin(
      documentRequirements,
      and(
        eq(documentRequirements.companyId, personDocuments.companyId),
        eq(documentRequirements.id, personDocuments.requirementId),
      ),
    )
    .where(
      withTenant(
        personDocuments,
        companyId,
        eq(personDocuments.id, documentId),
        personId ? eq(personDocuments.personId, personId) : undefined,
      ),
    )
    .limit(1);

  return row?.fileKey && row.fileContentType ? row : null;
};

const signedFileUrl = async (
  companyId: string,
  row: NonNullable<Awaited<ReturnType<typeof findDocumentFile>>>,
  actor: { kind: "hr_user"; userId: string } | { kind: "employee" },
) => {
  const storage = getObjectStorage();
  if (!storage) return null;

  await recordPersonalDataAccess(companyId, {
    personId: row.personId,
    resource: "document_file",
    resourceId: row.id,
    actorKind: actor.kind,
    actorUserId: actor.kind === "hr_user" ? actor.userId : null,
  });

  return storage.signedUrl(row.fileKey!, {
    filename: fileName(row.requirementName, row.fileContentType!),
    contentType: row.fileContentType!,
  });
};

/**
 * HR (documents:read, checked by the route): a short-lived URL for a file of
 * this company, and its access-log row. Null when the id is not in the
 * company or has no file.
 */
export const documentFileUrlForHr = async (
  companyId: string,
  documentId: string,
  actorUserId: string,
) => {
  const row = await findDocumentFile(companyId, documentId, null);
  return row
    ? signedFileUrl(companyId, row, { kind: "hr_user", userId: actorUserId })
    : null;
};

/** The employee's own file only; anyone else's id is null (404). */
export const documentFileUrlForEmployee = async (
  context: EmployeeContext,
  documentId: string,
) => {
  const row = await findDocumentFile(
    context.companyId,
    documentId,
    context.personId,
  );
  return row
    ? signedFileUrl(context.companyId, row, { kind: "employee" })
    : null;
};

// ---------------------------------------------------------------- review

export const REVIEW_QUEUE_LIMIT = 100;

export type ReviewQueueRow = {
  id: string;
  personId: string;
  personName: string;
  positionName: string | null;
  requirementName: string;
  validityMonths: number | null;
  uploadedAt: Date;
  fileContentType: string | null;
  fileSize: number | null;
};

/**
 * HR's review queue: uploads waiting for a decision, oldest first, from the
 * partial index on status = 'uploaded'. The first 100 and the total.
 */
export const listDocumentReviewQueue = async (companyId: string) => {
  const scoped = tdb(companyId);
  const pending = withTenant(
    personDocuments,
    companyId,
    eq(personDocuments.status, "uploaded"),
  );

  const [rows, [total]] = await Promise.all([
    scoped
      .select({
        id: personDocuments.id,
        personId: personDocuments.personId,
        nombres: people.nombres,
        apellidoPaterno: people.apellidoPaterno,
        apellidoMaterno: people.apellidoMaterno,
        positionName: positions.name,
        requirementName: documentRequirements.name,
        validityMonths: documentRequirements.validityMonths,
        uploadedAt: personDocuments.createdAt,
        fileContentType: personDocuments.fileContentType,
        fileSize: personDocuments.fileSize,
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
        ),
      )
      .leftJoin(
        positions,
        and(
          eq(positions.companyId, people.companyId),
          eq(positions.id, people.positionId),
        ),
      )
      .where(pending)
      .orderBy(asc(personDocuments.createdAt), asc(personDocuments.id))
      .limit(REVIEW_QUEUE_LIMIT),
    scoped.select({ value: count() }).from(personDocuments).where(pending),
  ]);

  return {
    total: total?.value ?? 0,
    rows: rows.map((row): ReviewQueueRow => ({
      id: row.id,
      personId: row.personId,
      personName: formatPersonName(row),
      positionName: row.positionName,
      requirementName: row.requirementName,
      validityMonths: row.validityMonths,
      uploadedAt: row.uploadedAt,
      fileContentType: row.fileContentType,
      fileSize: row.fileSize,
    })),
  };
};

/**
 * Accepts or rejects a pending upload. Accepting makes it the delivery:
 * expiresOn omitted is filled from validity_months from the upload date, the
 * rule recordDelivery uses. Rejecting stores the reason and deletes the file
 * after the commit. Null when the id is not a pending upload of the company
 * (already reviewed, another company, or not an upload).
 */
export const reviewDocument = async (
  companyId: string,
  input: ReviewDocumentInput,
  actorUserId: string,
) => {
  const outcome = await withTransaction(async (tx) => {
    const [current] = await tx
      .select({
        document: personDocuments,
        requirementName: documentRequirements.name,
        validityMonths: documentRequirements.validityMonths,
      })
      .from(personDocuments)
      .innerJoin(
        documentRequirements,
        and(
          eq(documentRequirements.companyId, personDocuments.companyId),
          eq(documentRequirements.id, personDocuments.requirementId),
        ),
      )
      .where(
        withTenant(
          personDocuments,
          companyId,
          eq(personDocuments.id, input.documentId),
          eq(personDocuments.status, "uploaded"),
        ),
      )
      .for("update", { of: personDocuments })
      .limit(1);

    if (!current) return null;

    const before = current.document;
    const reviewedAt = new Date();
    const changes =
      input.decision === "accept"
        ? {
            status: "accepted" as const,
            expiresOn:
              input.expiresOn !== undefined
                ? input.expiresOn
                : current.validityMonths
                  ? addCalendarMonths(
                      before.deliveredOn,
                      current.validityMonths,
                    )
                  : null,
          }
        : {
            status: "rejected" as const,
            rejectionReason: input.reason,
            fileKey: null,
            fileContentType: null,
            fileSize: null,
          };

    if (
      changes.status === "accepted" &&
      changes.expiresOn &&
      changes.expiresOn < before.deliveredOn
    ) {
      return { error: "La vigencia no puede ser anterior a la entrega." };
    }

    const [updated] = await tx
      .update(personDocuments)
      .set({ ...changes, reviewedBy: actorUserId, reviewedAt })
      .where(
        withTenant(
          personDocuments,
          companyId,
          eq(personDocuments.id, before.id),
        ),
      )
      .returning();

    await recordAuditEvent(
      {
        companyId,
        actorUserId,
        resourceType: "person_document",
        resourceId: before.id,
        action: input.decision === "accept" ? "approve" : "reject",
        payload: {
          before: { ...snapshotPersonDocument(before), status: before.status },
          after: {
            ...snapshotPersonDocument(updated),
            status: updated.status,
            rejectionReason: updated.rejectionReason ?? null,
          },
          summary:
            input.decision === "accept"
              ? `Documento aceptado: ${current.requirementName}`
              : `Documento rechazado: ${current.requirementName} (${documentRejectionReasonLabels[input.reason]})`,
        },
      },
      tx,
    );

    // W2-13: the review on the timeline. An accepted paper counts on the
    // day it was handed in, like recordDelivery; a rejection when decided.
    await appendPersonEvents(
      companyId,
      [
        documentEvent(
          updated,
          "app",
          updated.status === "accepted" ? "accepted" : "rejected",
          updated.status === "accepted"
            ? {}
            : { occurredAt: reviewedAt, reason: updated.rejectionReason },
        ),
      ],
      tx,
    );

    // W2-08: the person hears that a rejected paper needs a new upload.
    const notified =
      input.decision === "reject"
        ? await createNotifications(
            companyId,
            {
              template: "document_rejected",
              data: {
                document: current.requirementName,
                reason: `${documentRejectionReasonLabels[input.reason]}.`,
              },
              recipients: [personRecipient(before.personId)],
              eventKey: `person_document:${before.id}:rejected`,
              url: "/mi/documentos",
            },
            tx,
          )
        : [];

    return {
      updated,
      notified: notified.length > 0,
      deletedKey: input.decision === "reject" ? before.fileKey : null,
    };
  }, companyId);

  if (outcome && "notified" in outcome && outcome.notified) {
    await sendNotificationsSoon(companyId);
  }

  if (outcome && "deletedKey" in outcome && outcome.deletedKey) {
    const storage = getObjectStorage();
    await storage?.delete(outcome.deletedKey).catch((error) => {
      logger.error(
        { err: error, companyId, documentId: input.documentId },
        "Rejected document file could not be deleted",
      );
    });
  }

  return outcome;
};
