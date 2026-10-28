import { z } from "zod";

import { listExpiringDocuments } from "@/lib/documents";
import { EXPIRING_WITHIN_DAYS } from "@/lib/documents/schema";
import { DOCUMENT_STATUS_LABELS } from "@/lib/documents/person-card";
import type {
  ExpiringDocumentRow,
  ExpiringDocumentStatus,
} from "@/lib/documents/expiring";

import {
  cursorSchema,
  decodeCursor,
  filtersHash,
  limitSchema,
  pageOf,
} from "../cursor";
import { defineTool, readAnnotations } from "../run-tool";
import {
  appUrl,
  mx,
  nextCursorSchema,
  personRefSchema,
  refSchema,
  uuid,
} from "./common";

const TRAY_STATUSES = ["por_vencer", "vencido"] as const;

const domainStatus = (
  status: (typeof TRAY_STATUSES)[number],
): ExpiringDocumentStatus => (status === "vencido" ? "expired" : "expiring");

const daysLeft = (expiresOn: string, today: string) =>
  Math.round(
    (Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      86_400_000,
  );

/** Continues after (expires_on, id), the same order as the tray. */
const pageRows = (
  rows: readonly ExpiringDocumentRow[],
  after: { key: string; id: string } | null,
  limit: number,
) => {
  const rest = after
    ? rows.filter(
        (row) =>
          row.expiresOn > after.key ||
          (row.expiresOn === after.key && row.id > after.id),
      )
    : rows;

  return rest.slice(0, limit + 1);
};

/**
 * Read-only. The rows are `listExpiringDocuments`: the same list as the
 * bandeja, for this connection's company only.
 */
export const listExpiringDocumentsTool = defineTool({
  name: "list_expiring_documents",
  title: "Documentos por vencer",
  description:
    "La bandeja «Documentos por vencer»: la entrega más reciente de cada persona y requisito que vence hoy o en los próximos 30 días (por_vencer, el valor por defecto) o que ya venció (vencido). La misma lista que la bandeja, ordenada por fecha de vencimiento. No incluye archivos, números de documento ni notas.",
  kind: "read",
  scope: "read",
  permission: "documents:read",
  input: z.object({
    position_id: uuid("Sólo personas de este puesto.").optional(),
    status: z
      .enum(TRAY_STATUSES)
      .default("por_vencer")
      .describe(
        "por_vencer: vence hoy o en 30 días. vencido: la vigencia ya pasó.",
      ),
    cursor: cursorSchema,
    limit: limitSchema,
  }),
  output: z.object({
    as_of: z.string(),
    as_of_mx: z.string().nullable(),
    window_days: z.literal(EXPIRING_WITHIN_DAYS),
    status: z.enum(TRAY_STATUSES),
    items: z.array(
      z.object({
        document_id: z.string(),
        person: personRefSchema,
        position: refSchema,
        requirement_id: z.string(),
        requirement_name: z.string(),
        delivered_on: z.string(),
        delivered_on_mx: z.string().nullable(),
        expires_on: z.string(),
        expires_on_mx: z.string().nullable(),
        days_left: z.number().int(),
        status: z.enum(["expiring", "expired"]),
        status_label: z.string(),
        url: z.string(),
      }),
    ),
    next_cursor: nextCursorSchema,
  }),
  annotations: readAnnotations("Documentos por vencer"),
  handler: async ({ cursor, limit, ...filters }, ctx) => {
    const hash = filtersHash("list_expiring_documents", {
      ...filters,
      today: ctx.today,
    });
    const rows = await listExpiringDocuments(ctx.companyId, ctx.today, {
      positionId: filters.position_id,
      status: domainStatus(filters.status),
    });
    const page = pageOf(
      pageRows(rows, decodeCursor(cursor, hash), limit),
      limit,
      hash,
      (row) => row.expiresOn,
    );

    return {
      as_of: ctx.today,
      as_of_mx: mx(ctx.today),
      window_days: EXPIRING_WITHIN_DAYS as 30,
      status: filters.status,
      items: page.items.map((row) => ({
        document_id: row.id,
        person: { id: row.personId, nombre_completo: row.personName },
        position:
          row.positionId && row.positionName
            ? { id: row.positionId, name: row.positionName }
            : null,
        requirement_id: row.requirementId,
        requirement_name: row.requirementName,
        delivered_on: row.deliveredOn,
        delivered_on_mx: mx(row.deliveredOn),
        expires_on: row.expiresOn,
        expires_on_mx: mx(row.expiresOn),
        days_left: daysLeft(row.expiresOn, ctx.today),
        status: row.status,
        status_label: DOCUMENT_STATUS_LABELS[row.status],
        url: appUrl(ctx, `/app/personas/${row.personId}#expediente-documentos`),
      })),
      next_cursor: page.next_cursor,
    };
  },
});
