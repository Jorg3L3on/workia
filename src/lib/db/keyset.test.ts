import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { people, personEvents } from "@/lib/db/schema";

import { clampPageSize, defineKeyset } from "./keyset";

const dialect = new PgDialect();
const render = (fragment: ReturnType<typeof sql> | undefined) =>
  fragment ? dialect.sqlToQuery(fragment) : undefined;
const cursorOf = (values: unknown[]) =>
  Buffer.from(JSON.stringify(values), "utf8").toString("base64url");

describe("defineKeyset", () => {
  const timeline = defineKeyset([
    { column: personEvents.occurredAt, type: "timestamptz", direction: "desc" },
    { column: personEvents.id, type: "uuid", direction: "desc" },
  ]);

  it("compiles one direction to a row comparison the index can start at", () => {
    expect(
      render(
        timeline.after(
          cursorOf([
            "2026-11-04T14:00:00.123456+00:00",
            "00000000-0000-0000-0000-000000000001",
          ]),
        ),
      ),
    ).toMatchObject({
      sql: '("person_events"."occurred_at", "person_events"."id") < ($1::timestamptz, $2::uuid)',
      params: [
        "2026-11-04T14:00:00.123456+00:00",
        "00000000-0000-0000-0000-000000000001",
      ],
    });
  });

  it("bounds the first key when directions are mixed", () => {
    const mixed = defineKeyset([
      { column: people.apellidoPaterno, type: "text" },
      { column: people.id, type: "uuid", direction: "desc" },
    ]);

    expect(render(mixed.after(cursorOf(["Lara", "x"])))?.sql).toBe(
      '("people"."apellido_paterno" >= $1::text and (("people"."apellido_paterno" > $2::text) or ("people"."apellido_paterno" = $3::text and "people"."id" < $4::uuid)))',
    );
  });

  it("starts over on a missing, malformed or foreign cursor", () => {
    for (const cursor of [
      undefined,
      null,
      "",
      "%%%",
      cursorOf(["only one"]),
      cursorOf([null, "x"]),
      cursorOf([{}, "x"]),
      "a".repeat(5000),
    ]) {
      expect(timeline.after(cursor)).toBeUndefined();
    }
  });

  it("returns limit rows and a cursor only when there is another page", () => {
    const rows = [1, 2, 3].map((n) => ({ n, cursor: `["${n}"]` }));

    const first = timeline.page(rows, 2);
    expect(first.items).toEqual([{ n: 1 }, { n: 2 }]);
    expect(
      JSON.parse(Buffer.from(first.next!, "base64url").toString("utf8")),
    ).toEqual(["2"]);

    expect(timeline.page(rows, 3)).toEqual({
      items: [{ n: 1 }, { n: 2 }, { n: 3 }],
      next: null,
    });
  });

  it("orders by every key in its direction", () => {
    expect(
      timeline.orderBy.map((fragment) => dialect.sqlToQuery(fragment).sql),
    ).toEqual([
      '"person_events"."occurred_at" desc',
      '"person_events"."id" desc',
    ]);
  });

  it("needs a key", () => {
    expect(() => defineKeyset([])).toThrow();
  });
});

describe("clampPageSize", () => {
  it("keeps the size between 1 and the maximum", () => {
    expect(clampPageSize(undefined, 50, 200)).toBe(50);
    expect(clampPageSize(0, 50, 200)).toBe(1);
    expect(clampPageSize(10_000, 50, 200)).toBe(200);
    expect(clampPageSize(Number.NaN, 50, 200)).toBe(50);
    expect(clampPageSize(12.7, 50, 200)).toBe(12);
  });
});
