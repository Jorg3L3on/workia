import { and, eq, lt, sql } from "drizzle-orm";

import { tdb } from "@/lib/db";
import { mcpIdempotency } from "@/lib/db/schema";

/** A write's reply is kept 24 hours per idempotency key (spec §7). */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

const PENDING = { pending: true } as const;

export type IdempotencyReservation =
  | { state: "new"; id: string }
  | { state: "replay"; response: Record<string, unknown> }
  | { state: "mismatch" }
  | { state: "pending" };

const isPending = (response: unknown) =>
  Boolean(response && typeof response === "object" && "pending" in response);

/**
 * Reserves an idempotency key before a write: a new key gets a pending row
 * (unique per company, connection and key), a finished one replays its reply,
 * the same key with other arguments is a mismatch. Expired rows of the
 * connection are cleaned up here, lazily.
 */
export const reserveIdempotencyKey = async (
  companyId: string,
  input: { connectionId: string; key: string; tool: string; argsHash: string },
  now = new Date(),
): Promise<IdempotencyReservation> => {
  const db = tdb(companyId);

  await db
    .delete(mcpIdempotency)
    .where(
      and(
        eq(mcpIdempotency.companyId, companyId),
        eq(mcpIdempotency.connectionId, input.connectionId),
        lt(mcpIdempotency.expiresAt, now),
      ),
    );

  const [created] = await db
    .insert(mcpIdempotency)
    .values({
      companyId,
      connectionId: input.connectionId,
      key: input.key,
      tool: input.tool,
      argsHash: input.argsHash,
      response: PENDING,
      expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
    })
    .onConflictDoNothing()
    .returning({ id: mcpIdempotency.id });

  if (created) {
    return { state: "new", id: created.id };
  }

  const [existing] = await db
    .select()
    .from(mcpIdempotency)
    .where(
      and(
        eq(mcpIdempotency.companyId, companyId),
        eq(mcpIdempotency.connectionId, input.connectionId),
        eq(mcpIdempotency.key, input.key),
      ),
    )
    .limit(1);

  if (!existing) {
    return reserveIdempotencyKey(companyId, input, now);
  }

  if (existing.tool !== input.tool || existing.argsHash !== input.argsHash) {
    return { state: "mismatch" };
  }

  return isPending(existing.response)
    ? { state: "pending" }
    : {
        state: "replay",
        response: existing.response as Record<string, unknown>,
      };
};

/** A finished key's reply, without reserving (a retry that skipped the preview). */
export const findIdempotentReply = async (
  companyId: string,
  input: { connectionId: string; key: string; tool: string; argsHash: string },
  now = new Date(),
) => {
  const [existing] = await tdb(companyId)
    .select()
    .from(mcpIdempotency)
    .where(
      and(
        eq(mcpIdempotency.companyId, companyId),
        eq(mcpIdempotency.connectionId, input.connectionId),
        eq(mcpIdempotency.key, input.key),
        sql`${mcpIdempotency.expiresAt} > ${now}`,
      ),
    )
    .limit(1);

  if (!existing || isPending(existing.response)) {
    return null;
  }

  if (existing.tool !== input.tool || existing.argsHash !== input.argsHash) {
    return { mismatch: true as const };
  }

  return { response: existing.response as Record<string, unknown> };
};

/** Stores the reply of a finished write under its reserved key. */
export const completeIdempotencyKey = async (
  companyId: string,
  id: string,
  response: Record<string, unknown>,
) => {
  await tdb(companyId)
    .update(mcpIdempotency)
    .set({ response })
    .where(
      and(eq(mcpIdempotency.companyId, companyId), eq(mcpIdempotency.id, id)),
    );
};

/** Frees a reserved key when the write failed, so a retry can run. */
export const releaseIdempotencyKey = async (companyId: string, id: string) => {
  await tdb(companyId)
    .delete(mcpIdempotency)
    .where(
      and(eq(mcpIdempotency.companyId, companyId), eq(mcpIdempotency.id, id)),
    );
};
