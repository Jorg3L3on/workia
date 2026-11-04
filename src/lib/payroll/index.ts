import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";

import { recordAuditEvent } from "@/lib/audit";
import { tdb, withTransaction, type DbExecutor } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/errors";
import {
  employeeAccounts,
  payrollEmployeeNumbers,
  payrollPeriods,
  payrollReceipts,
  people,
  type PayrollMatchKind,
} from "@/lib/db/schema";
import type { EmployeeContext } from "@/lib/employee-accounts/sign-in";
import { logger } from "@/lib/logger";
import { formatPersonName } from "@/lib/people/schema";
import { recordPersonalDataAccess } from "@/lib/privacy";
import { getObjectStorage, objectKey, type ObjectStorage } from "@/lib/storage";
import { withTenant } from "@/lib/tenant/scope";

import {
  CFDI_XML_MAX_BYTES,
  cfdiParseErrorLabels,
  GENERIC_RFCS,
  parseCfdiNomina,
  type CfdiNomina,
} from "./cfdi";
import { sendReceiptsAvailableEmail } from "./emails";
import {
  looksLikePdf,
  PAYROLL_COPY,
  RECEIPT_PDF_MAX_BYTES,
  RECEIPT_URL_SECONDS,
  type CreatePeriodInput,
} from "./schema";

/**
 * Nómina receipts (W2-03). HR imports the stamped CFDI of a period, each one
 * is matched to a person by CURP, then NumEmpleado, then RFC, and publishing
 * the period delivers them. Files go to object storage; the database keeps
 * only identifiers and timestamps, never an amount. Permission checks live in
 * the actions and routes; every query here filters by company_id.
 */

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const requireStorage = (): ObjectStorage => {
  const storage = getObjectStorage();

  if (!storage) {
    throw new Error(PAYROLL_COPY.storageMissing);
  }

  return storage;
};

export const payrollStorageReady = () => getObjectStorage() !== null;

/** Where a receipt's files live: by company and period, named by the CFDI UUID. */
export const receiptObjectKey = (
  companyId: string,
  periodId: string,
  cfdiUuid: string,
  ext: "xml" | "pdf",
) =>
  objectKey({
    companyId,
    area: "receipts",
    segments: [periodId, cfdiUuid],
    ext,
  });

// ---------------------------------------------------------------- periods

const periodCounts = {
  receipts: count(payrollReceipts.id),
  matched: count(payrollReceipts.personId),
  delivered: count(payrollReceipts.deliveredAt),
  opened: count(payrollReceipts.openedAt),
};

const numberCounts = <T extends Record<keyof typeof periodCounts, unknown>>(
  row: T,
) => ({
  ...row,
  receipts: Number(row.receipts),
  matched: Number(row.matched),
  delivered: Number(row.delivered),
  opened: Number(row.opened),
});

export const createPayrollPeriod = async (
  companyId: string,
  input: CreatePeriodInput,
  actorUserId?: string | null,
): Promise<Result<{ id: string }>> => {
  try {
    return await withTransaction(async (tx) => {
      const [created] = await tx
        .insert(payrollPeriods)
        .values({
          companyId,
          label: input.label.trim(),
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          createdBy: actorUserId ?? null,
        })
        .returning({ id: payrollPeriods.id });

      await recordAuditEvent(
        {
          companyId,
          actorUserId: actorUserId ?? null,
          resourceType: "payroll_period",
          resourceId: created.id,
          action: "create",
          payload: {
            summary: `Periodo de nómina ${input.label.trim()}`,
            after: { ...input, label: input.label.trim() },
          },
        },
        tx,
      );

      return { ok: true, value: { id: created.id } } as const;
    }, companyId);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: PAYROLL_COPY.periodLabelTaken };
    }

    throw error;
  }
};

/** Every period, newest first, with how many receipts were matched, delivered and opened. */
export const listPayrollPeriods = async (companyId: string) => {
  const rows = await tdb(companyId)
    .select({
      id: payrollPeriods.id,
      label: payrollPeriods.label,
      periodStart: payrollPeriods.periodStart,
      periodEnd: payrollPeriods.periodEnd,
      status: payrollPeriods.status,
      publishedAt: payrollPeriods.publishedAt,
      createdAt: payrollPeriods.createdAt,
      ...periodCounts,
    })
    .from(payrollPeriods)
    .leftJoin(
      payrollReceipts,
      and(
        eq(payrollReceipts.companyId, payrollPeriods.companyId),
        eq(payrollReceipts.periodId, payrollPeriods.id),
      ),
    )
    .where(withTenant(payrollPeriods, companyId))
    .groupBy(payrollPeriods.id)
    .orderBy(desc(payrollPeriods.periodEnd), desc(payrollPeriods.createdAt))
    .limit(200);

  return rows.map(numberCounts);
};

export const getPayrollPeriod = async (
  companyId: string,
  periodId: string,
  executor: DbExecutor = tdb(companyId),
) => {
  const [row] = await executor
    .select({
      id: payrollPeriods.id,
      label: payrollPeriods.label,
      periodStart: payrollPeriods.periodStart,
      periodEnd: payrollPeriods.periodEnd,
      status: payrollPeriods.status,
      publishedAt: payrollPeriods.publishedAt,
      createdAt: payrollPeriods.createdAt,
      ...periodCounts,
    })
    .from(payrollPeriods)
    .leftJoin(
      payrollReceipts,
      and(
        eq(payrollReceipts.companyId, payrollPeriods.companyId),
        eq(payrollReceipts.periodId, payrollPeriods.id),
      ),
    )
    .where(
      withTenant(payrollPeriods, companyId, eq(payrollPeriods.id, periodId)),
    )
    .groupBy(payrollPeriods.id)
    .limit(1);

  return row ? numberCounts(row) : null;
};

/** Receipts of one period, unmatched first, then by name. Capped for egress. */
export const listPayrollReceipts = async (
  companyId: string,
  periodId: string,
) => {
  const rows = await tdb(companyId)
    .select({
      id: payrollReceipts.id,
      personId: payrollReceipts.personId,
      matchKind: payrollReceipts.matchKind,
      cfdiUuid: payrollReceipts.cfdiUuid,
      receptorRfc: payrollReceipts.receptorRfc,
      receptorCurp: payrollReceipts.receptorCurp,
      receptorNumEmpleado: payrollReceipts.receptorNumEmpleado,
      receptorName: payrollReceipts.receptorName,
      paymentDate: payrollReceipts.paymentDate,
      hasPdf: sql<boolean>`${payrollReceipts.pdfKey} IS NOT NULL`,
      deliveredAt: payrollReceipts.deliveredAt,
      openedAt: payrollReceipts.openedAt,
      nombres: people.nombres,
      apellidoPaterno: people.apellidoPaterno,
      apellidoMaterno: people.apellidoMaterno,
    })
    .from(payrollReceipts)
    .leftJoin(
      people,
      and(
        eq(people.companyId, payrollReceipts.companyId),
        eq(people.id, payrollReceipts.personId),
      ),
    )
    .where(
      withTenant(
        payrollReceipts,
        companyId,
        eq(payrollReceipts.periodId, periodId),
      ),
    )
    .orderBy(
      sql`${payrollReceipts.personId} IS NOT NULL`,
      asc(people.apellidoPaterno),
      asc(people.nombres),
      asc(payrollReceipts.receptorName),
    )
    .limit(5_000);

  return rows.map(({ nombres, apellidoPaterno, apellidoMaterno, ...row }) => ({
    ...row,
    personName:
      nombres && apellidoPaterno
        ? formatPersonName({ nombres, apellidoPaterno, apellidoMaterno })
        : null,
  }));
};

// --------------------------------------------------------------- matching

/**
 * The person a CFDI belongs to: by the CURP of the nómina complement, then by
 * the provider's NumEmpleado learned from earlier receipts, then by the
 * receptor RFC (SAT's generic RFCs never match). Only live (not borrado)
 * people of the company; a person on baja still matches, because a finiquito
 * also has a receipt.
 */
export const matchReceiptPerson = async (
  companyId: string,
  cfdi: Pick<CfdiNomina, "curp" | "numEmpleado" | "receptorRfc">,
  executor: DbExecutor = tdb(companyId),
): Promise<{ personId: string; matchKind: PayrollMatchKind } | null> => {
  const rfc = GENERIC_RFCS.has(cfdi.receptorRfc) ? null : cfdi.receptorRfc;
  const identity = [
    cfdi.curp ? eq(people.curp, cfdi.curp) : undefined,
    rfc ? eq(people.rfc, rfc) : undefined,
  ].filter(Boolean);
  const [byIdentity, byNumber] = await Promise.all([
    identity.length > 0
      ? executor
          .select({ id: people.id, curp: people.curp, rfc: people.rfc })
          .from(people)
          .where(
            withTenant(
              people,
              companyId,
              isNull(people.deletedAt),
              or(...identity),
            ),
          )
          .limit(4)
      : Promise.resolve([]),
    cfdi.numEmpleado
      ? executor
          .select({ personId: payrollEmployeeNumbers.personId })
          .from(payrollEmployeeNumbers)
          .innerJoin(
            people,
            and(
              eq(people.companyId, payrollEmployeeNumbers.companyId),
              eq(people.id, payrollEmployeeNumbers.personId),
              isNull(people.deletedAt),
            ),
          )
          .where(
            withTenant(
              payrollEmployeeNumbers,
              companyId,
              eq(payrollEmployeeNumbers.numEmpleado, cfdi.numEmpleado),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
  ]);

  const byCurp = cfdi.curp
    ? byIdentity.find((person) => person.curp === cfdi.curp)
    : undefined;

  if (byCurp) {
    return { personId: byCurp.id, matchKind: "curp" };
  }

  if (byNumber[0]) {
    return { personId: byNumber[0].personId, matchKind: "num_empleado" };
  }

  const byRfc = rfc
    ? byIdentity.find((person) => person.rfc === rfc)
    : undefined;

  return byRfc ? { personId: byRfc.id, matchKind: "rfc" } : null;
};

/** Remembers the provider's number for a person, replacing an older owner. */
const rememberEmployeeNumber = async (
  companyId: string,
  numEmpleado: string | null,
  personId: string,
  executor: DbExecutor,
) => {
  if (!numEmpleado) {
    return;
  }

  await executor
    .insert(payrollEmployeeNumbers)
    .values({ companyId, numEmpleado, personId })
    .onConflictDoUpdate({
      target: [
        payrollEmployeeNumbers.companyId,
        payrollEmployeeNumbers.numEmpleado,
      ],
      set: { personId, updatedAt: new Date() },
    });
};

// ----------------------------------------------------------------- import

export type ImportReceiptFiles = {
  xml: Uint8Array;
  pdf: Uint8Array | null;
};

export type ImportReceiptOutcome =
  | {
      status: "matched";
      receiptId: string;
      matchKind: PayrollMatchKind;
    }
  | { status: "unmatched"; receiptId: string }
  | { status: "duplicate" }
  | { status: "invalid"; error: string };

/**
 * Imports one CFDI (XML and its PDF) into a period: parses it, matches it,
 * stores both files and writes the receipt row. A CFDI already imported in
 * the company (same UUID) is a duplicate and changes nothing, so a zip can be
 * uploaded again after an interruption. In a published period a matched
 * receipt is delivered at once. Null when the period is not in the company.
 */
export const importPayrollReceipt = async (
  companyId: string,
  periodId: string,
  files: ImportReceiptFiles,
  actorUserId?: string | null,
): Promise<ImportReceiptOutcome | null> => {
  const period = await getPayrollPeriod(companyId, periodId);

  if (!period) {
    return null;
  }

  if (files.xml.byteLength > CFDI_XML_MAX_BYTES) {
    return { status: "invalid", error: PAYROLL_COPY.xmlTooLarge };
  }

  if (files.pdf && files.pdf.byteLength > RECEIPT_PDF_MAX_BYTES) {
    return { status: "invalid", error: PAYROLL_COPY.pdfTooLarge };
  }

  if (files.pdf && !looksLikePdf(files.pdf)) {
    return { status: "invalid", error: PAYROLL_COPY.pdfInvalid };
  }

  const parsed = parseCfdiNomina(new TextDecoder().decode(files.xml));

  if (!parsed.ok) {
    return { status: "invalid", error: cfdiParseErrorLabels[parsed.error] };
  }

  const cfdi = parsed.value;
  const scoped = tdb(companyId);
  const [existing] = await scoped
    .select({ id: payrollReceipts.id })
    .from(payrollReceipts)
    .where(
      withTenant(
        payrollReceipts,
        companyId,
        eq(payrollReceipts.cfdiUuid, cfdi.uuid),
      ),
    )
    .limit(1);

  if (existing) {
    return { status: "duplicate" };
  }

  const storage = requireStorage();
  const xmlKey = receiptObjectKey(companyId, periodId, cfdi.uuid, "xml");
  const pdfKey = files.pdf
    ? receiptObjectKey(companyId, periodId, cfdi.uuid, "pdf")
    : null;

  await storage.put(xmlKey, files.xml, "application/xml");

  if (files.pdf && pdfKey) {
    await storage.put(pdfKey, files.pdf, "application/pdf");
  }

  try {
    return await withTransaction(async (tx) => {
      const match = await matchReceiptPerson(companyId, cfdi, tx);
      const deliveredAt =
        match && period.status === "published" ? new Date() : null;
      const [created] = await tx
        .insert(payrollReceipts)
        .values({
          companyId,
          periodId,
          personId: match?.personId ?? null,
          matchKind: match?.matchKind ?? null,
          cfdiUuid: cfdi.uuid,
          receptorRfc: cfdi.receptorRfc,
          receptorCurp: cfdi.curp,
          receptorNumEmpleado: cfdi.numEmpleado,
          receptorName: cfdi.receptorName,
          paymentDate: cfdi.paymentDate,
          xmlKey,
          xmlBytes: files.xml.byteLength,
          pdfKey,
          pdfBytes: files.pdf?.byteLength ?? null,
          uploadedBy: actorUserId ?? null,
          deliveredAt,
        })
        .returning({ id: payrollReceipts.id });

      if (match && match.matchKind !== "num_empleado") {
        await rememberEmployeeNumber(
          companyId,
          cfdi.numEmpleado,
          match.personId,
          tx,
        );
      }

      return match
        ? ({
            status: "matched",
            receiptId: created.id,
            matchKind: match.matchKind,
          } as const)
        : ({ status: "unmatched", receiptId: created.id } as const);
    }, companyId);
  } catch (error) {
    if (isUniqueViolation(error)) {
      // A parallel upload of the same CFDI won; its row points at the same keys.
      return { status: "duplicate" };
    }

    await Promise.allSettled(
      [xmlKey, pdfKey].flatMap((key) => (key ? [storage.delete(key)] : [])),
    );
    throw error;
  }
};

/**
 * Records the end of one import in the audit, with what came in. The upload
 * itself is many small requests; this is the one event HR sees for it.
 */
export const recordPayrollImport = async (
  companyId: string,
  periodId: string,
  summary: {
    matched: number;
    unmatched: number;
    duplicate: number;
    invalid: number;
  },
  actorUserId?: string | null,
) => {
  const period = await getPayrollPeriod(companyId, periodId);

  if (!period) {
    return null;
  }

  await recordAuditEvent({
    companyId,
    actorUserId: actorUserId ?? null,
    resourceType: "payroll_period",
    resourceId: periodId,
    action: "import",
    payload: {
      summary: `Recibos importados en ${period.label}`,
      after: summary,
    },
  });

  return period;
};

// ------------------------------------------------------------- unmatched

/**
 * HR matches an unmatched receipt to a person by hand. The CFDI's NumEmpleado
 * is remembered for that person, so the next period matches by itself. In a
 * published period the receipt is delivered at once.
 */
export const assignPayrollReceipt = async (
  companyId: string,
  receiptId: string,
  personId: string,
  actorUserId?: string | null,
): Promise<Result<{ delivered: boolean }>> =>
  withTransaction(async (tx) => {
    const [receipt] = await tx
      .select({
        id: payrollReceipts.id,
        personId: payrollReceipts.personId,
        cfdiUuid: payrollReceipts.cfdiUuid,
        receptorNumEmpleado: payrollReceipts.receptorNumEmpleado,
        periodStatus: payrollPeriods.status,
      })
      .from(payrollReceipts)
      .innerJoin(
        payrollPeriods,
        and(
          eq(payrollPeriods.companyId, payrollReceipts.companyId),
          eq(payrollPeriods.id, payrollReceipts.periodId),
        ),
      )
      .where(
        withTenant(
          payrollReceipts,
          companyId,
          eq(payrollReceipts.id, receiptId),
        ),
      )
      .for("update", { of: payrollReceipts })
      .limit(1);

    if (!receipt) {
      return { ok: false, error: PAYROLL_COPY.receiptNotFound } as const;
    }

    if (receipt.personId) {
      return { ok: false, error: PAYROLL_COPY.receiptAlreadyMatched } as const;
    }

    const [person] = await tx
      .select({ id: people.id })
      .from(people)
      .where(
        withTenant(
          people,
          companyId,
          eq(people.id, personId),
          isNull(people.deletedAt),
        ),
      )
      .limit(1);

    if (!person) {
      return { ok: false, error: PAYROLL_COPY.personNotFound } as const;
    }

    const delivered = receipt.periodStatus === "published";

    await tx
      .update(payrollReceipts)
      .set({
        personId,
        matchKind: "manual",
        deliveredAt: delivered ? new Date() : null,
      })
      .where(
        withTenant(
          payrollReceipts,
          companyId,
          eq(payrollReceipts.id, receiptId),
        ),
      );
    await rememberEmployeeNumber(
      companyId,
      receipt.receptorNumEmpleado,
      personId,
      tx,
    );
    await recordAuditEvent(
      {
        companyId,
        actorUserId: actorUserId ?? null,
        resourceType: "payroll_receipt",
        resourceId: receiptId,
        action: "link",
        payload: {
          summary: "Recibo de nómina asignado a mano",
          after: { personId, cfdiUuid: receipt.cfdiUuid },
        },
      },
      tx,
    );

    return { ok: true, value: { delivered } } as const;
  }, companyId);

// ---------------------------------------------------------------- publish

/**
 * Publishes a draft period: every matched receipt is delivered now, and the
 * people with an active employee account get one email. Unmatched receipts
 * stay for HR; matching one later delivers it.
 */
export const publishPayrollPeriod = async (
  companyId: string,
  periodId: string,
  actorUserId?: string | null,
  options: { origin?: string } = {},
): Promise<Result<{ delivered: number; emailed: number }>> => {
  const published = await withTransaction(async (tx) => {
    const [period] = await tx
      .update(payrollPeriods)
      .set({
        status: "published",
        publishedAt: new Date(),
        publishedBy: actorUserId ?? null,
      })
      .where(
        withTenant(
          payrollPeriods,
          companyId,
          eq(payrollPeriods.id, periodId),
          eq(payrollPeriods.status, "draft"),
        ),
      )
      .returning({ id: payrollPeriods.id, label: payrollPeriods.label });

    if (!period) {
      const exists = await getPayrollPeriod(companyId, periodId, tx);

      return {
        ok: false,
        error: exists
          ? PAYROLL_COPY.periodAlreadyPublished
          : PAYROLL_COPY.periodNotFound,
      } as const;
    }

    const delivered = await tx
      .update(payrollReceipts)
      .set({ deliveredAt: new Date() })
      .where(
        withTenant(
          payrollReceipts,
          companyId,
          eq(payrollReceipts.periodId, periodId),
          isNotNull(payrollReceipts.personId),
          isNull(payrollReceipts.deliveredAt),
        ),
      )
      .returning({ personId: payrollReceipts.personId });

    await recordAuditEvent(
      {
        companyId,
        actorUserId: actorUserId ?? null,
        resourceType: "payroll_period",
        resourceId: periodId,
        action: "publish",
        payload: {
          summary: `Periodo de nómina ${period.label} publicado`,
          after: { delivered: delivered.length },
        },
      },
      tx,
    );

    return {
      ok: true,
      label: period.label,
      personIds: [
        ...new Set<string>(
          delivered.flatMap((row) => (row.personId ? [row.personId] : [])),
        ),
      ],
    } as const;
  }, companyId);

  if (!published.ok) {
    return published;
  }

  const emailed = await notifyReceiptsAvailable(
    companyId,
    published.personIds,
    published.label,
    options.origin,
  );

  return {
    ok: true,
    value: { delivered: published.personIds.length, emailed },
  };
};

/**
 * One email per person with an active account and a verified email. A
 * failure is logged and skipped: the receipt is in the app either way.
 * W2-08 notifications can take this over (template «receipt available»).
 */
const notifyReceiptsAvailable = async (
  companyId: string,
  personIds: readonly string[],
  label: string,
  origin?: string,
) => {
  if (personIds.length === 0 || !origin) {
    return 0;
  }

  const accounts = await tdb(companyId)
    .select({ email: employeeAccounts.email })
    .from(employeeAccounts)
    .where(
      withTenant(
        employeeAccounts,
        companyId,
        eq(employeeAccounts.status, "active"),
        isNotNull(employeeAccounts.emailVerifiedAt),
        inArray(employeeAccounts.personId, [...personIds]),
      ),
    );
  let sent = 0;

  for (const { email } of accounts) {
    if (!email) {
      continue;
    }

    try {
      await sendReceiptsAvailableEmail({ to: email, label, origin });
      sent += 1;
    } catch (error) {
      logger.warn({ err: error, companyId }, "Receipt email not sent");
    }
  }

  return sent;
};

/**
 * Discards a draft period and its receipts (a wrong zip): rows first, in one
 * transaction, then the files. A published period cannot be discarded.
 */
export const discardPayrollPeriod = async (
  companyId: string,
  periodId: string,
  actorUserId?: string | null,
): Promise<Result<{ receipts: number }>> => {
  const result = await withTransaction(async (tx) => {
    const [period] = await tx
      .select({
        id: payrollPeriods.id,
        label: payrollPeriods.label,
        status: payrollPeriods.status,
      })
      .from(payrollPeriods)
      .where(
        withTenant(payrollPeriods, companyId, eq(payrollPeriods.id, periodId)),
      )
      .for("update")
      .limit(1);

    if (!period) {
      return { ok: false, error: PAYROLL_COPY.periodNotFound } as const;
    }

    if (period.status !== "draft") {
      return { ok: false, error: PAYROLL_COPY.periodNotDraft } as const;
    }

    const receipts = await tx
      .delete(payrollReceipts)
      .where(
        withTenant(
          payrollReceipts,
          companyId,
          eq(payrollReceipts.periodId, periodId),
        ),
      )
      .returning({
        xmlKey: payrollReceipts.xmlKey,
        pdfKey: payrollReceipts.pdfKey,
      });

    await tx
      .delete(payrollPeriods)
      .where(
        withTenant(payrollPeriods, companyId, eq(payrollPeriods.id, periodId)),
      );
    await recordAuditEvent(
      {
        companyId,
        actorUserId: actorUserId ?? null,
        resourceType: "payroll_period",
        resourceId: periodId,
        action: "delete",
        payload: {
          summary: `Importación de ${period.label} descartada`,
          before: { label: period.label, receipts: receipts.length },
        },
      },
      tx,
    );

    return {
      ok: true,
      keys: receipts.flatMap((row) => [
        row.xmlKey,
        ...(row.pdfKey ? [row.pdfKey] : []),
      ]),
    } as const;
  }, companyId);

  if (!result.ok) {
    return result;
  }

  const storage = getObjectStorage();

  if (storage) {
    const deletions = await Promise.allSettled(
      result.keys.map((key) => storage.delete(key)),
    );
    const failed = deletions.filter(
      (outcome) => outcome.status === "rejected",
    ).length;

    if (failed > 0) {
      logger.warn(
        { companyId, periodId, failed },
        "Receipt files left in storage",
      );
    }
  }

  return {
    ok: true,
    value: {
      receipts: result.keys.filter((key) => key.endsWith(".xml")).length,
    },
  };
};

// --------------------------------------------------------------- download

export type ReceiptFileKind = "pdf" | "xml";

export type ReceiptReader =
  { kind: "employee"; personId: string } | { kind: "hr_user"; userId: string };

/**
 * A short-lived link to a receipt's PDF or XML, after writing the personal
 * data access log (W2-09) and, the first time its employee opens it,
 * opened_at, in one transaction. An employee only gets their own delivered
 * receipts; HR gets any receipt of the company. Null when there is nothing
 * to hand out (not found, not theirs, not delivered, no PDF).
 */
export const openPayrollReceiptFile = async (
  companyId: string,
  receiptId: string,
  file: ReceiptFileKind,
  reader: ReceiptReader,
) => {
  const storage = getObjectStorage();

  if (!storage) {
    return null;
  }

  const [receipt] = await tdb(companyId)
    .select({
      id: payrollReceipts.id,
      personId: payrollReceipts.personId,
      cfdiUuid: payrollReceipts.cfdiUuid,
      xmlKey: payrollReceipts.xmlKey,
      pdfKey: payrollReceipts.pdfKey,
      deliveredAt: payrollReceipts.deliveredAt,
      openedAt: payrollReceipts.openedAt,
      label: payrollPeriods.label,
    })
    .from(payrollReceipts)
    .innerJoin(
      payrollPeriods,
      and(
        eq(payrollPeriods.companyId, payrollReceipts.companyId),
        eq(payrollPeriods.id, payrollReceipts.periodId),
      ),
    )
    .where(
      withTenant(payrollReceipts, companyId, eq(payrollReceipts.id, receiptId)),
    )
    .limit(1);

  if (!receipt) {
    return null;
  }

  if (
    reader.kind === "employee" &&
    (receipt.personId !== reader.personId || !receipt.deliveredAt)
  ) {
    return null;
  }

  const key = file === "pdf" ? receipt.pdfKey : receipt.xmlKey;

  if (!key) {
    return null;
  }

  await withTransaction(async (tx) => {
    if (receipt.personId) {
      await recordPersonalDataAccess(
        companyId,
        {
          personId: receipt.personId,
          resource: "payroll_receipt",
          resourceId: receipt.id,
          actorKind: reader.kind,
          actorUserId: reader.kind === "hr_user" ? reader.userId : null,
        },
        tx,
      );
    }

    if (reader.kind === "employee" && !receipt.openedAt) {
      await tx
        .update(payrollReceipts)
        .set({ openedAt: new Date() })
        .where(
          withTenant(
            payrollReceipts,
            companyId,
            eq(payrollReceipts.id, receipt.id),
            isNull(payrollReceipts.openedAt),
          ),
        );
    }
  }, companyId);

  const filename = `recibo-${receipt.label.replace(/[^\w-]+/g, "-")}-${receipt.cfdiUuid.slice(0, 8)}.${file}`;

  return {
    url: await storage.signedUrl(key, {
      filename,
      contentType: file === "pdf" ? "application/pdf" : "application/xml",
      expiresInSeconds: RECEIPT_URL_SECONDS,
      disposition: file === "pdf" ? "inline" : "attachment",
    }),
  };
};

// --------------------------------------------------------------- employee

/**
 * The signed-in employee's delivered receipts, newest period first (W2-03).
 * Read only with the guard's company and person, never with an id from the
 * request.
 */
export const listEmployeeReceipts = async (context: EmployeeContext) => {
  const rows = await tdb(context.companyId)
    .select({
      id: payrollReceipts.id,
      label: payrollPeriods.label,
      periodStart: payrollPeriods.periodStart,
      periodEnd: payrollPeriods.periodEnd,
      paymentDate: payrollReceipts.paymentDate,
      hasPdf: sql<boolean>`${payrollReceipts.pdfKey} IS NOT NULL`,
      deliveredAt: payrollReceipts.deliveredAt,
      openedAt: payrollReceipts.openedAt,
    })
    .from(payrollReceipts)
    .innerJoin(
      payrollPeriods,
      and(
        eq(payrollPeriods.companyId, payrollReceipts.companyId),
        eq(payrollPeriods.id, payrollReceipts.periodId),
      ),
    )
    .where(
      withTenant(
        payrollReceipts,
        context.companyId,
        eq(payrollReceipts.personId, context.personId),
        isNotNull(payrollReceipts.deliveredAt),
      ),
    )
    .orderBy(desc(payrollPeriods.periodEnd), desc(payrollReceipts.paymentDate))
    .limit(120);

  return rows;
};

/** How many delivered receipts the employee has not opened yet, for the home. */
export const countUnopenedEmployeeReceipts = async (
  context: EmployeeContext,
) => {
  const [row] = await tdb(context.companyId)
    .select({ value: count() })
    .from(payrollReceipts)
    .where(
      withTenant(
        payrollReceipts,
        context.companyId,
        eq(payrollReceipts.personId, context.personId),
        isNotNull(payrollReceipts.deliveredAt),
        isNull(payrollReceipts.openedAt),
      ),
    );

  return Number(row?.value ?? 0);
};
