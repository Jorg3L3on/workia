import { eq } from "drizzle-orm";

import { recordAuditEvent } from "@/lib/audit";
import { tdb } from "@/lib/db";
import { mcpSettings } from "@/lib/db/schema";

/** The company's MCP switches. Writes are off until someone turns them on (D-17). */
export const getMcpSettings = async (companyId: string) => {
  const [row] = await tdb(companyId)
    .select()
    .from(mcpSettings)
    .where(eq(mcpSettings.companyId, companyId))
    .limit(1);

  return {
    writesEnabled: row?.writesEnabled ?? false,
    updatedAt: row?.updatedAt ?? null,
  };
};

/** Turns MCP writes on or off for the company, effective on the next call. */
export const setMcpWritesEnabled = async (
  companyId: string,
  enabled: boolean,
  actorUserId: string,
) => {
  const [row] = await tdb(companyId)
    .insert(mcpSettings)
    .values({ companyId, writesEnabled: enabled, updatedBy: actorUserId })
    .onConflictDoUpdate({
      target: mcpSettings.companyId,
      set: {
        writesEnabled: enabled,
        updatedBy: actorUserId,
        updatedAt: new Date(),
      },
    })
    .returning();

  await recordAuditEvent({
    companyId,
    actorUserId,
    resourceType: "mcp_settings",
    resourceId: companyId,
    action: enabled ? "activate" : "deactivate",
    payload: {
      summary: enabled
        ? "Escrituras del conector MCP encendidas"
        : "Escrituras del conector MCP apagadas",
    },
  });

  return row;
};
