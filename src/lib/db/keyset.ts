import { asc, desc, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * Keyset (cursor) pagination for lists (Workia 2.0 P-04, docs/keyset.md).
 * Generalizes the export's `id > last id` pages (src/lib/import/export.ts) to
 * any sort with a unique last key. A page reads `limit + 1` rows that start
 * right after the cursor, so it costs the same on page 1 and page 500. OFFSET
 * is banned in new queries by the lint rule in eslint.config.mjs.
 *
 * The cursor is opaque to callers: the key values as Postgres renders them in
 * JSON, base64url-encoded. They are compared back with an explicit cast, so a
 * microsecond timestamp round-trips exactly (a JS Date would cut it to
 * milliseconds and skip or repeat rows).
 */

/** SQL types a key may have. Fixed so the cast below is never user input. */
export type KeysetType = "uuid" | "text" | "timestamptz" | "date" | "integer";

export type KeysetKey = {
  /** A NOT NULL column or expression. The last key must be unique (usually id). */
  column: AnyPgColumn | SQL;
  type: KeysetType;
  direction?: "asc" | "desc";
};

export type KeysetPage<T> = {
  items: T[];
  /** Pass back as `cursor` for the next page; null on the last one. */
  next: string | null;
};

const MAX_CURSOR_LENGTH = 2048;

/** The page size a caller asked for, between 1 and `max`. */
export const clampPageSize = (
  limit: number | undefined,
  fallback: number,
  max: number,
) => {
  const value = Number.isFinite(limit) ? Math.trunc(limit as number) : fallback;
  return Math.min(Math.max(value, 1), max);
};

const encode = (json: string) =>
  Buffer.from(json, "utf8").toString("base64url");

/**
 * A cursor for these key values, in key order, as a page's `next` would be.
 * For a list that receives its position from elsewhere (the approvals inbox
 * merges several sources and hands each one the last item's keys). Each value
 * must be what Postgres casts back to the key's type: a timestamptz with its
 * zone and microseconds, a uuid, a date.
 */
export const keysetCursor = (values: Array<string | number>) =>
  encode(JSON.stringify(values));

/**
 * The key values of a cursor, or null when it is missing, malformed or made
 * for another key list (an old link or a tampered one): the list then starts
 * from the first page.
 */
const decode = (cursor: string | null | undefined, length: number) => {
  if (!cursor || cursor.length > MAX_CURSOR_LENGTH) return null;

  try {
    const values: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );

    if (
      Array.isArray(values) &&
      values.length === length &&
      values.every(
        (value) =>
          (typeof value === "string" && value.length <= 256) ||
          (typeof value === "number" && Number.isFinite(value)),
      )
    ) {
      return values as Array<string | number>;
    }
  } catch {
    // Not base64url JSON: same as no cursor.
  }

  return null;
};

export type Keyset = {
  /** The ORDER BY of every page. */
  orderBy: SQL[];
  /** Select it as `cursor`; `page` turns it into the next cursor. */
  cursor: SQL<string>;
  /** The WHERE condition for the rows after `cursor`; undefined on the first page. */
  after: (cursor: string | null | undefined) => SQL | undefined;
  /**
   * Splits `limit + 1` rows into the page and the next cursor, and drops the
   * `cursor` field from each row.
   */
  page: <T extends { cursor: string }>(
    rows: T[],
    limit: number,
  ) => KeysetPage<Omit<T, "cursor">>;
};

/**
 * A keyset over `keys`, in order. Same direction on every key compiles to a
 * row comparison, `(a, b) > ($1, $2)`, which a btree on (a, b) uses as its
 * start; mixed directions compile to `a >= $1 AND (a > $1 OR (a = $1 AND ...))`
 * so the first key still bounds the scan.
 */
export const defineKeyset = (keys: readonly KeysetKey[]): Keyset => {
  if (keys.length === 0) {
    throw new Error("A keyset needs at least one key.");
  }

  const direction = (key: KeysetKey) => key.direction ?? "asc";
  const sameDirection = keys.every(
    (key) => direction(key) === direction(keys[0]),
  );
  const value = (key: KeysetKey, raw: string | number) =>
    sql`${String(raw)}::${sql.raw(key.type)}`;

  const after = (cursor: string | null | undefined) => {
    const values = decode(cursor, keys.length);
    if (!values) return undefined;

    if (sameDirection) {
      const op = direction(keys[0]) === "asc" ? sql`>` : sql`<`;
      return sql`(${sql.join(
        keys.map((key) => sql`${key.column}`),
        sql`, `,
      )}) ${op} (${sql.join(
        keys.map((key, index) => value(key, values[index])),
        sql`, `,
      )})`;
    }

    const strict = (key: KeysetKey, index: number) =>
      direction(key) === "asc"
        ? sql`${key.column} > ${value(key, values[index])}`
        : sql`${key.column} < ${value(key, values[index])}`;
    const branches = keys.map((key, index) =>
      sql.join(
        [
          ...keys
            .slice(0, index)
            .map(
              (prior, priorIndex) =>
                sql`${prior.column} = ${value(prior, values[priorIndex])}`,
            ),
          strict(key, index),
        ],
        sql` and `,
      ),
    );
    const first = keys[0];
    const bound =
      direction(first) === "asc"
        ? sql`${first.column} >= ${value(first, values[0])}`
        : sql`${first.column} <= ${value(first, values[0])}`;

    return sql`(${bound} and (${sql.join(
      branches.map((branch) => sql`(${branch})`),
      sql` or `,
    )}))`;
  };

  return {
    orderBy: keys.map((key) =>
      direction(key) === "asc" ? asc(key.column) : desc(key.column),
    ),
    cursor: sql<string>`json_build_array(${sql.join(
      keys.map((key) => sql`${key.column}`),
      sql`, `,
    )})::text`,
    after,
    page: (rows, limit) => {
      const items = rows.slice(0, limit).map((row) => {
        const { cursor: _cursor, ...rest } = row;
        void _cursor;
        return rest;
      });
      const last = rows[limit - 1];

      return {
        items,
        next: rows.length > limit && last ? encode(last.cursor) : null,
      };
    },
  };
};
