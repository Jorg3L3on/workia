import { describe, expect, it } from "vitest";

import {
  decodeInboxCursor,
  encodeInboxCursor,
  listApprovalsInbox,
  type InboxItem,
  type InboxSource,
} from "./inbox";
import type { ManagerAccess } from "./scope";

const access: ManagerAccess = {
  companyId: "c",
  accountId: "acc",
  personId: "boss",
  scopes: [
    {
      managerAccountId: "acc",
      managerPersonId: "boss",
      managerName: "Jefa",
      includeIndirect: false,
      via: "own",
      endsOn: null,
    },
  ],
};

const item = (source: string, id: string, sortKey: string): InboxItem => ({
  source,
  id,
  sortKey,
  personId: "p",
  personName: "Ana",
  title: "Solicitud",
  detail: null,
  approverPersonId: "boss",
  href: "/mi/equipo",
});

/** A source over a fixed list that honors the cursor like a keyset query would. */
const fixed = (key: string, items: InboxItem[]): InboxSource => ({
  key,
  list: async ({ after, limit }) =>
    items
      .filter(
        (candidate) =>
          !after ||
          candidate.sortKey < after.sortKey ||
          (candidate.sortKey === after.sortKey && candidate.id < after.id),
      )
      .sort((x, y) =>
        x.sortKey === y.sortKey
          ? y.id.localeCompare(x.id)
          : y.sortKey.localeCompare(x.sortKey),
      )
      .slice(0, limit),
});

describe("approvals inbox", () => {
  it("is empty with no sources", async () => {
    expect(await listApprovalsInbox(access, { sources: [] })).toEqual({
      items: [],
      next: null,
    });
  });

  it("merges sources newest first and pages without repeats or gaps", async () => {
    const vacations = fixed("vacaciones", [
      item("vacaciones", "v1", "2026-11-01T10:00:00.000001"),
      item("vacaciones", "v2", "2026-11-03T10:00:00.000000"),
      item("vacaciones", "v3", "2026-11-03T10:00:00.000000"),
    ]);
    const permisos = fixed("permisos", [
      item("permisos", "p1", "2026-11-02T10:00:00.000000"),
      item("permisos", "p2", "2026-11-01T10:00:00.000002"),
    ]);
    const sources = [vacations, permisos];

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Awaited<ReturnType<typeof listApprovalsInbox>> =
        await listApprovalsInbox(access, { sources, limit: 2, cursor });
      seen.push(...page.items.map((entry) => entry.id));
      cursor = page.next;
    } while (cursor);

    expect(seen).toEqual(["v3", "v2", "p1", "p2", "v1"]);
  });

  it("round-trips the cursor and ignores a tampered one", () => {
    const after = { sortKey: "2026-11-01T10:00:00.000001", id: "x" };
    expect(decodeInboxCursor(encodeInboxCursor(after))).toEqual(after);
    expect(decodeInboxCursor("%%%")).toBeNull();
    expect(decodeInboxCursor(null)).toBeNull();
  });
});
