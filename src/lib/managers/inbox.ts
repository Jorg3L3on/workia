import type { ManagerAccess } from "./scope";

/**
 * The manager's approvals inbox (Workia 2.0 W2-07): one list, newest first,
 * of everything waiting for a decision of the managers this account acts for
 * (itself and whoever it covers for today). Each kind of request is a
 * source; W2-06 adds vacaciones and permisos, later tasks add theirs.
 *
 * A source pages its own table with a keyset on (created_at DESC, id DESC)
 * filtered by approver and status, through the index docs/keyset.md fixes
 * for the requests table. The inbox merges the sources' pages and hands out
 * one opaque cursor, so no list in it uses OFFSET.
 */

export type InboxItem = {
  /** The source's key, e.g. "request". With id it identifies the item. */
  source: string;
  id: string;
  /**
   * The row's created_at as fixed-width UTC text with microseconds,
   * `to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`,
   * so items of different sources sort as strings and a timestamp keeps
   * its microseconds (a JS Date would cut them and skip or repeat rows).
   */
  sortKey: string;
  personId: string;
  personName: string;
  title: string;
  detail: string | null;
  /** The approver stored on the request: one of approverPersonIds(access). */
  approverPersonId: string;
  href: string;
};

export type InboxAfter = { sortKey: string; id: string } | null;

export type InboxSource = {
  key: string;
  /**
   * Up to `limit` pending items whose approver is one of `approverIds`,
   * strictly after `after` in (sortKey DESC, id DESC) order. A source runs
   * one query in the access's company and never reads another company.
   */
  list: (input: {
    access: ManagerAccess;
    approverIds: string[];
    after: InboxAfter;
    limit: number;
  }) => Promise<InboxItem[]>;
};

/** The registered sources. W2-06 adds its requests source here. */
export const INBOX_SOURCES: InboxSource[] = [];

export const INBOX_PAGE_SIZE = 30;

const compareDesc = (a: InboxItem, b: InboxItem) =>
  a.sortKey === b.sortKey
    ? a.id === b.id
      ? a.source < b.source
        ? 1
        : -1
      : a.id < b.id
        ? 1
        : -1
    : a.sortKey < b.sortKey
      ? 1
      : -1;

export const encodeInboxCursor = (after: NonNullable<InboxAfter>) =>
  Buffer.from(JSON.stringify([after.sortKey, after.id])).toString("base64url");

/** An unreadable cursor starts the inbox over instead of failing. */
export const decodeInboxCursor = (value?: string | null): InboxAfter => {
  if (!value) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );

    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    ) {
      return { sortKey: parsed[0], id: parsed[1] };
    }
  } catch {
    // Falls through.
  }

  return null;
};

/**
 * One page of the inbox. Every source returns at most limit + 1 items after
 * the cursor; the merge keeps the first `limit`, so the next page starts
 * right after the last item shown in every source.
 */
export const listApprovalsInbox = async (
  access: ManagerAccess,
  options: {
    cursor?: string | null;
    limit?: number;
    sources?: InboxSource[];
  } = {},
): Promise<{ items: InboxItem[]; next: string | null }> => {
  const limit = Math.min(Math.max(options.limit ?? INBOX_PAGE_SIZE, 1), 100);
  const sources = options.sources ?? INBOX_SOURCES;
  // approverPersonIds(access), without loading the database client here.
  const approverIds = access.scopes.map((scope) => scope.managerPersonId);
  const after = decodeInboxCursor(options.cursor);

  if (sources.length === 0 || approverIds.length === 0) {
    return { items: [], next: null };
  }

  const pages = await Promise.all(
    sources.map((source) =>
      source.list({ access, approverIds, after, limit: limit + 1 }),
    ),
  );
  // A source must not return another approver's items; drop them if it does.
  const merged = pages
    .flat()
    .filter((item) => approverIds.includes(item.approverPersonId))
    .sort(compareDesc);
  const items = merged.slice(0, limit);
  const last = items.at(-1);

  return {
    items,
    next:
      merged.length > limit && last
        ? encodeInboxCursor({ sortKey: last.sortKey, id: last.id })
        : null,
  };
};
