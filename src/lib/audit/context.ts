import { AsyncLocalStorage } from "node:async_hooks";

import type { AuditRequestMeta, RecordAuditEventInput } from "./types";

/**
 * Who is writing, for every audit event recorded inside `run` (WRK-I1-5):
 * an MCP tool runs its domain write in this context, so the existing domain
 * functions record `source: "mcp"` and the connection without new arguments.
 */
export type AuditContext = {
  source: NonNullable<RecordAuditEventInput["source"]>;
  requestMeta: AuditRequestMeta;
};

type AuditStore = AuditContext & { eventIds: string[] };

const storage = new AsyncLocalStorage<AuditStore>();

/** Runs `fn` with this audit context; returns its result and the events it recorded. */
export const runWithAuditContext = async <T>(
  context: AuditContext,
  fn: () => Promise<T>,
): Promise<{ result: T; eventIds: string[] }> => {
  const store: AuditStore = { ...context, eventIds: [] };
  const result = await storage.run(store, fn);

  return { result, eventIds: store.eventIds };
};

export const currentAuditContext = () => storage.getStore() ?? null;

/** Called by recordAuditEvent after inserting, to report the ids back to the caller. */
export const noteAuditEvent = (id: string) => {
  storage.getStore()?.eventIds.push(id);
};
