import { z } from "zod";

import { listAuditEventsKeyset, maskAuditCompensation } from "@/lib/audit";
import {
  AUDIT_ACTIONS,
  AUDIT_RESOURCE_TYPES,
  auditActionLabels,
  auditResourceTypeLabels,
  type AuditAction,
  type AuditResourceType,
} from "@/lib/audit/types";

import {
  cursorSchema,
  decodeCursor,
  filtersHash,
  limitSchema,
  pageOf,
} from "../cursor";
import { McpToolError } from "../errors";
import { maskDeep } from "../mask";
import { defineTool, readAnnotations } from "../run-tool";
import { FREE_TEXT_NOTE, mxDateTime, nextCursorSchema, uuid } from "./common";
import { compensationVisible } from "./compensation";

const SOURCES = ["app", "seed", "system", "import", "mcp"] as const;

const dateTime = (description: string) =>
  z.string().datetime({ offset: true }).describe(description);

export const listAuditEventsTool = defineTool({
  name: "list_audit_events",
  title: "Bitácora de auditoría",
  description: `Bitácora de cambios (append-only), más reciente primero: quién, qué recurso, qué acción, origen (app, seed, system, import, mcp) y el antes/después. Los datos personales del payload salen enmascarados sin el scope pii. ${FREE_TEXT_NOTE}`,
  kind: "read",
  scope: "audit",
  permission: "audit:read",
  input: z.object({
    resource_type: z.enum(AUDIT_RESOURCE_TYPES).optional(),
    resource_id: z.string().max(80).optional(),
    actor_user_id: uuid("Sólo cambios de esta persona usuaria.").optional(),
    action: z.enum(AUDIT_ACTIONS).optional(),
    source: z.enum(SOURCES).optional(),
    from: dateTime(
      "Desde (ISO 8601 con zona, p. ej. 2026-10-01T00:00:00-06:00).",
    ).optional(),
    to: dateTime("Hasta (ISO 8601 con zona).").optional(),
    cursor: cursorSchema,
    limit: limitSchema,
  }),
  output: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        occurred_at: z.string(),
        occurred_at_mx: z.string().nullable(),
        actor: z
          .object({ id: z.string(), name: z.string().nullable() })
          .nullable(),
        resource_type: z.string(),
        resource_label: z.string(),
        resource_id: z.string(),
        action: z.string(),
        action_label: z.string(),
        result: z.string(),
        source: z.string(),
        request_meta: z.record(z.string(), z.unknown()).nullable(),
        payload: z.record(z.string(), z.unknown()).nullable(),
      }),
    ),
    next_cursor: nextCursorSchema,
    pii_masked: z.boolean(),
  }),
  annotations: readAnnotations("Bitácora de auditoría"),
  handler: async ({ cursor, limit, ...filters }, ctx) => {
    if (filters.from && filters.to && filters.from > filters.to) {
      throw new McpToolError("VALIDATION", "«from» es posterior a «to».");
    }

    const hash = filtersHash("list_audit_events", filters);
    const rows = await listAuditEventsKeyset(ctx.companyId, {
      resourceType: filters.resource_type,
      resourceId: filters.resource_id,
      actorUserId: filters.actor_user_id,
      action: filters.action,
      source: filters.source,
      from: filters.from ? new Date(filters.from) : undefined,
      to: filters.to ? new Date(filters.to) : undefined,
      after: decodeCursor(cursor, hash),
      limit,
    });
    const page = pageOf(rows, limit, hash, (row) => row.sortKey);

    return {
      items: page.items.map((row) => {
        const payload = (row.payload ?? null) as Record<string, unknown> | null;

        return {
          id: row.id,
          occurred_at: row.occurredAt.toISOString(),
          occurred_at_mx: mxDateTime(row.occurredAt),
          actor: row.actorUserId
            ? { id: row.actorUserId, name: row.actorName }
            : null,
          resource_type: row.resourceType,
          resource_label:
            auditResourceTypeLabels[row.resourceType as AuditResourceType] ??
            row.resourceType,
          resource_id: row.resourceId,
          action: row.action,
          action_label:
            auditActionLabels[row.action as AuditAction] ?? row.action,
          result: row.result,
          source: row.source,
          request_meta: (row.requestMeta ?? null) as Record<
            string,
            unknown
          > | null,
          payload:
            payload && !ctx.piiUnmasked
              ? (maskDeep(payload) as Record<string, unknown>)
              : payload && !compensationVisible(ctx)
                ? // pii but no compensation:read: salaries and finiquito as «•••».
                  maskAuditCompensation(payload)
                : payload,
        };
      }),
      next_cursor: page.next_cursor,
      pii_masked: !ctx.piiUnmasked,
    };
  },
});
