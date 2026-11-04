import type { TimelineCursor } from "@/lib/timeline";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A group timeline cursor in a URL: `<ISO instant>~<event id>`. */
export const encodeTimelineCursor = (cursor: TimelineCursor) =>
  `${cursor.occurredAt.toISOString()}~${cursor.id}`;

/** Null for anything that is not a cursor this page wrote. */
export const decodeTimelineCursor = (
  value: string | undefined | null,
): TimelineCursor | null => {
  const [instant, id] = (value ?? "").split("~");
  const occurredAt = new Date(instant ?? "");

  return id && UUID.test(id) && !Number.isNaN(occurredAt.getTime())
    ? { occurredAt, id }
    : null;
};
