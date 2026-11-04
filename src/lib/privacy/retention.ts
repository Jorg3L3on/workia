import { and, eq, inArray, lt, ne, sql } from "drizzle-orm";

import { recordAuditEvent } from "@/lib/audit";
import { db, withTransaction } from "@/lib/db";
import {
  arcoRequests,
  companies,
  personalDataAccessLog,
} from "@/lib/db/schema";
import { withTenant } from "@/lib/tenant/scope";

/**
 * Retention per record type (W2-09). Rows marked «automatic» are deleted by
 * the retention job, in batches; the rest are kept and listed so HR can see
 * the rule. Every period is «pendiente de revisión legal»: the legal review
 * of the notice confirms or changes them. The job never touches labor
 * records (people, contracts, employment periods, vacations), which the LFT,
 * the LSS and the CFF require employers to keep.
 */
export type RetentionRule = {
  key: string;
  label: string;
  period: string;
  basis: string;
  /** Months after `from` that the job deletes; null when nothing is deleted automatically. */
  automaticMonths: number | null;
};

export const ACCESS_LOG_RETENTION_MONTHS = 24;
export const CLOSED_ARCO_RETENTION_MONTHS = 60;

export const RETENTION_POLICY: readonly RetentionRule[] = [
  {
    key: "personal_data_access_log",
    label: "Registro de accesos a documentos y recibos",
    period: `${ACCESS_LOG_RETENTION_MONTHS} meses desde el acceso`,
    basis: "Evidencia de las medidas de seguridad (LFPDPPP).",
    automaticMonths: ACCESS_LOG_RETENTION_MONTHS,
  },
  {
    key: "arco_requests",
    label: "Solicitudes ARCO cerradas",
    period: `${CLOSED_ARCO_RETENTION_MONTHS / 12} años desde el cierre`,
    basis: "Evidencia de la respuesta al titular (LFPDPPP).",
    automaticMonths: CLOSED_ARCO_RETENTION_MONTHS,
  },
  {
    key: "privacy_notice_acceptances",
    label: "Aceptaciones del aviso de privacidad",
    period: "Mientras exista el expediente de la persona",
    basis: "Prueba del consentimiento (LFPDPPP).",
    automaticMonths: null,
  },
  {
    key: "people",
    label: "Expediente, contratos y periodos laborales",
    period: "La relación laboral y al menos 5 años después de la baja",
    basis: "LFT art. 804, LSS art. 15 y CFF art. 30.",
    automaticMonths: null,
  },
  {
    key: "vacation_records",
    label: "Vacaciones tomadas",
    period: "La relación laboral y al menos 1 año después de la baja",
    basis: "LFT art. 804.",
    automaticMonths: null,
  },
  {
    key: "audit_events",
    label: "Auditoría",
    period: "Sin borrado automático",
    basis: "Rastro de quién hizo qué; se revisa con el volumen real.",
    automaticMonths: null,
  },
];

/** Rows one statement deletes, so a run stays short on Neon Free compute. */
export const RETENTION_BATCH_SIZE = 500;

const monthsBefore = (now: Date, months: number) => {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return cutoff;
};

/**
 * Deletes, in this company, the rows past their automatic period: up to
 * `maxBatches` batches of `batchSize` per table. Returns how many rows went
 * and whether more remain, and writes one audit event when anything did.
 */
export const purgeExpiredPersonalData = async (
  companyId: string,
  options: { now?: Date; batchSize?: number; maxBatches?: number } = {},
) => {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? RETENTION_BATCH_SIZE;
  const maxBatches = options.maxBatches ?? 20;
  const accessCutoff = monthsBefore(now, ACCESS_LOG_RETENTION_MONTHS);
  const arcoCutoff = monthsBefore(now, CLOSED_ARCO_RETENTION_MONTHS);

  /** Runs `step` until a batch comes back short or maxBatches is reached. */
  const drain = async (step: () => Promise<number>) => {
    let total = 0;
    let last = 0;

    for (let batch = 0; batch < maxBatches; batch += 1) {
      last = await step();
      total += last;

      if (last < batchSize) {
        return { total, more: false };
      }
    }

    return { total, more: last === batchSize };
  };

  const access = await drain(() =>
    withTransaction(async (tx) => {
      const ids = tx
        .select({ id: personalDataAccessLog.id })
        .from(personalDataAccessLog)
        .where(
          withTenant(
            personalDataAccessLog,
            companyId,
            lt(personalDataAccessLog.accessedAt, accessCutoff),
          ),
        )
        .limit(batchSize);
      const rows = await tx
        .delete(personalDataAccessLog)
        .where(
          and(
            eq(personalDataAccessLog.companyId, companyId),
            inArray(personalDataAccessLog.id, ids),
          ),
        )
        .returning({ id: personalDataAccessLog.id });

      return rows.length;
    }, companyId),
  );

  const closedArco = await drain(() =>
    withTransaction(async (tx) => {
      const ids = tx
        .select({ id: arcoRequests.id })
        .from(arcoRequests)
        .where(
          withTenant(
            arcoRequests,
            companyId,
            ne(arcoRequests.status, "received"),
            lt(arcoRequests.resolvedAt, arcoCutoff),
          ),
        )
        .limit(batchSize);
      const rows = await tx
        .delete(arcoRequests)
        .where(
          and(
            eq(arcoRequests.companyId, companyId),
            inArray(arcoRequests.id, ids),
          ),
        )
        .returning({ id: arcoRequests.id });

      return rows.length;
    }, companyId),
  );

  const accessLog = access.total;
  const arco = closedArco.total;
  const more = access.more || closedArco.more;

  if (accessLog + arco > 0) {
    await recordAuditEvent({
      companyId,
      resourceType: "data_retention",
      resourceId: companyId,
      action: "delete",
      source: "system",
      payload: {
        after: { accessLog, arcoRequests: arco },
        summary: `Conservación de datos: ${accessLog} accesos y ${arco} solicitudes ARCO eliminados`,
      },
    });
  }

  return { accessLog, arcoRequests: arco, more };
};

/**
 * The retention job for every company, one after another. Called by the
 * cron route; it is not a company surface, so it reads the company list
 * without a tenant and then works inside each company.
 */
export const runRetentionJob = async (now: Date = new Date()) => {
  const rows = await db
    .select({ id: companies.id })
    .from(companies)
    .orderBy(sql`${companies.createdAt} asc`);
  const results: Array<
    { companyId: string } & Awaited<ReturnType<typeof purgeExpiredPersonalData>>
  > = [];

  for (const company of rows) {
    results.push({
      companyId: company.id,
      ...(await purgeExpiredPersonalData(company.id, { now })),
    });
  }

  return results;
};
