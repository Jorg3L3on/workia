// @vitest-environment node
import { describe, expect, it } from "vitest";

import { McpToolError } from "./errors";
import { decodeCursor, encodeCursor, filtersHash, pageOf } from "./cursor";

describe("signed cursors", () => {
  const hash = filtersHash("list_people", { status: "activa", site_id: "s1" });

  it("round-trips the keyset position", () => {
    const cursor = encodeCursor({ key: "López", id: "id-1" }, hash);
    expect(decodeCursor(cursor, hash)).toEqual({ key: "López", id: "id-1" });
  });

  it("ignores filter key order and undefined values", () => {
    expect(
      filtersHash("list_people", {
        site_id: "s1",
        status: "activa",
        query: undefined,
      }),
    ).toBe(hash);
  });

  it("refuses a cursor from other filters, another list or tampered", () => {
    const cursor = encodeCursor({ key: "López", id: "id-1" }, hash);
    const otherFilters = filtersHash("list_people", { status: "baja" });
    const otherList = filtersHash("list_assets", {
      status: "activa",
      site_id: "s1",
    });
    const [payload, signature] = cursor.split(".");
    const forged = `${Buffer.from(JSON.stringify({ k: "A", i: "x", f: hash })).toString("base64url")}.${signature}`;

    for (const [value, expected] of [
      [cursor, otherFilters],
      [cursor, otherList],
      [forged, hash],
      [`${payload}.xyz`, hash],
      ["basura", hash],
    ] as const) {
      expect(() => decodeCursor(value, expected)).toThrow(McpToolError);
      try {
        decodeCursor(value, expected);
      } catch (error) {
        expect((error as McpToolError).code).toBe("VALIDATION");
      }
    }
  });

  it("pages limit+1 rows into items and a next cursor", () => {
    const rows = [1, 2, 3].map((n) => ({ id: `id-${n}`, key: `k${n}` }));

    const first = pageOf(rows, 2, hash, (row) => row.key);
    expect(first.items).toHaveLength(2);
    expect(decodeCursor(first.next_cursor!, hash)).toEqual({
      key: "k2",
      id: "id-2",
    });

    expect(
      pageOf(rows.slice(0, 2), 2, hash, (row) => row.key).next_cursor,
    ).toBeNull();
  });
});
