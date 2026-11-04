/**
 * A group timeline cursor: the keyset cursor of listPersonEvents
 * (src/lib/db/keyset.ts, base64url JSON of occurred_at as Postgres renders it
 * and the event id) for the last event a page showed. Every linked row is
 * read with the same one, so the merged pages never skip or repeat; the
 * timestamp keeps its microseconds, which a JS Date would cut.
 */
export type TimelineCursor = string;

const CURSOR = /^[A-Za-z0-9_-]{1,512}$/;

/** As it goes in a URL; it is already URL-safe. */
export const encodeTimelineCursor = (cursor: TimelineCursor) => cursor;

/** Null for anything that cannot be a cursor; listPersonEvents rechecks it. */
export const decodeTimelineCursor = (
  value: string | undefined | null,
): TimelineCursor | null => (value && CURSOR.test(value) ? value : null);
