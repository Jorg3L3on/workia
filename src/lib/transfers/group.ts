import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { db, tdb } from "@/lib/db";
import {
  companies,
  people,
  personEvents,
  type PersonEventType,
} from "@/lib/db/schema";
import type { PermissionSlug } from "@/lib/db/schema/types";
import {
  getRolePermissionSlugs,
  isGroupAdmin,
  listActiveMemberships,
} from "@/lib/tenant/memberships";
import { withTenant } from "@/lib/tenant/scope";
import { listPersonEvents, MAX_TIMELINE_PAGE } from "@/lib/timeline";

import type { TimelineCursor } from "./cursor";

import { listPersonLinks, type PersonLinkRow } from "./index";

/**
 * Group reads (W2-24, docs/transfers.md): one person across the companies of
 * the group is the set of people rows connected by person_links. Every read
 * runs once per company, with that company's id for row-level security, and
 * the results are merged here. RLS is never turned off and nothing runs as
 * the table owner. A company the reader may not see stays a name: its row is
 * neither read nor followed.
 */

/** The companies whose people a user may read, by id, with their names. */
export type GroupReader = {
  userId: string;
  isGroupAdmin: boolean;
  companies: Map<string, string>;
};

const PEOPLE_READ: PermissionSlug = "people:read";

/**
 * What `userId` may read across the group: each company where their role has
 * people:read and, with the group admin grant, every active company.
 */
export const loadGroupReader = async (userId: string): Promise<GroupReader> => {
  const [memberships, groupAdmin] = await Promise.all([
    listActiveMemberships(userId),
    isGroupAdmin(userId),
  ]);
  const readable = new Map<string, string>();

  for (const membership of memberships) {
    const slugs = await getRolePermissionSlugs(membership.roleId);

    if (slugs.includes(PEOPLE_READ)) {
      readable.set(membership.companyId, membership.companyName);
    }
  }

  if (groupAdmin) {
    // companies is a platform table, outside RLS.
    const rows = await db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(and(eq(companies.status, "activa"), isNull(companies.deletedAt)))
      .orderBy(asc(companies.name));

    for (const row of rows) {
      readable.set(row.id, row.name);
    }
  }

  return { userId, isGroupAdmin: groupAdmin, companies: readable };
};

export type GroupNode = {
  companyId: string;
  companyName: string;
  personId: string;
  /** False for a company the reader may not see: only its name is shown. */
  visible: boolean;
  person: {
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string | null;
    status: "activa" | "baja";
    fechaIngreso: string | null;
    deleted: boolean;
  } | null;
  links: PersonLinkRow[];
};

/** The most rows one group may span; a person moves between a handful of companies. */
export const MAX_GROUP_ROWS = 16;

const readPerson = async (companyId: string, personId: string) => {
  const [row] = await tdb(companyId)
    .select({
      nombres: people.nombres,
      apellidoPaterno: people.apellidoPaterno,
      apellidoMaterno: people.apellidoMaterno,
      status: people.status,
      fechaIngreso: people.fechaIngreso,
      deletedAt: people.deletedAt,
    })
    .from(people)
    .where(withTenant(people, companyId, eq(people.id, personId)))
    .limit(1);

  if (!row) return null;

  const { deletedAt, ...rest } = row;
  return { ...rest, deleted: deletedAt !== null };
};

/**
 * The group person of one row: that row and every row linked to it, directly
 * or through other visible rows, starting from `companyId`, which the reader
 * must be able to read. Null when they cannot, or the row does not exist.
 */
export const getGroupPerson = async (
  reader: GroupReader,
  companyId: string,
  personId: string,
): Promise<GroupNode[] | null> => {
  if (!reader.companies.has(companyId)) {
    return null;
  }

  const nodes: GroupNode[] = [];
  const seen = new Set<string>([personId]);
  const queue: Array<{ companyId: string; personId: string; name?: string }> = [
    { companyId, personId },
  ];

  while (queue.length > 0 && nodes.length < MAX_GROUP_ROWS) {
    const next = queue.shift()!;
    const companyName = reader.companies.get(next.companyId);

    if (companyName === undefined) {
      nodes.push({
        companyId: next.companyId,
        companyName: next.name ?? "Otra empresa del grupo",
        personId: next.personId,
        visible: false,
        person: null,
        links: [],
      });
      continue;
    }

    const [person, links] = await Promise.all([
      readPerson(next.companyId, next.personId),
      listPersonLinks(next.companyId, next.personId),
    ]);

    if (!person) {
      if (nodes.length === 0) return null;
      continue;
    }

    nodes.push({
      companyId: next.companyId,
      companyName,
      personId: next.personId,
      visible: true,
      person,
      links,
    });

    for (const link of links) {
      if (seen.has(link.linkedPersonId)) continue;

      seen.add(link.linkedPersonId);
      queue.push({
        companyId: link.linkedCompanyId,
        personId: link.linkedPersonId,
        name: link.linkedCompanyName,
      });
    }
  }

  return nodes;
};

export type GroupTimelineEvent = {
  id: string;
  type: PersonEventType;
  occurredAt: Date;
  source: string;
  payload: Record<string, unknown>;
  companyId: string;
  companyName: string;
  personId: string;
};

export type GroupTimelinePage = {
  rows: GroupNode[];
  events: GroupTimelineEvent[];
  /** Pass back as `before` for the next (older) page; null on the last one. */
  next: TimelineCursor | null;
};

/**
 * The keyset cursor right after `event`, read from its own company under its
 * RLS so occurred_at keeps the microseconds Postgres stores.
 */
const cursorOf = async (event: GroupTimelineEvent) => {
  const [row] = await tdb(event.companyId)
    .select({
      key: sql<string>`json_build_array(${personEvents.occurredAt}, ${personEvents.id})::text`,
    })
    .from(personEvents)
    .where(
      withTenant(personEvents, event.companyId, eq(personEvents.id, event.id)),
    )
    .limit(1);

  return row ? Buffer.from(row.key, "utf8").toString("base64url") : null;
};

/** Newest first; ties by id, as person_events_person_time_idx orders them. */
const newestFirst = (a: GroupTimelineEvent, b: GroupTimelineEvent) =>
  b.occurredAt.getTime() - a.occurredAt.getTime() ||
  (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/**
 * The group timeline: the events of every visible linked row, merged newest
 * first, in keyset pages. Each row is one range scan of its own company's
 * index under that company's RLS, with the same cursor, so the merge never
 * skips or repeats an event. Null when the reader cannot read the start row.
 */
export const listGroupTimeline = async (
  reader: GroupReader,
  companyId: string,
  personId: string,
  options: {
    before?: TimelineCursor | null;
    limit?: number;
    types?: PersonEventType[];
  } = {},
): Promise<GroupTimelinePage | null> => {
  const rows = await getGroupPerson(reader, companyId, personId);

  if (!rows) {
    return null;
  }

  const limit = Math.min(Math.max(options.limit ?? 50, 1), MAX_TIMELINE_PAGE);
  const visible = rows.filter((row) => row.visible);
  const pages = await Promise.all(
    visible.map((row) =>
      listPersonEvents(row.companyId, row.personId, {
        cursor: options.before,
        limit,
        types: options.types,
      }),
    ),
  );
  const merged = pages
    .flatMap((page, index) =>
      page.events.map((event) => ({
        ...event,
        companyId: visible[index].companyId,
        companyName: visible[index].companyName,
        personId: visible[index].personId,
      })),
    )
    .sort(newestFirst);
  const events = merged.slice(0, limit);
  const last = events.at(-1);
  const more = merged.length > limit || pages.some((page) => page.next);

  return {
    rows,
    events,
    next: more && last ? await cursorOf(last) : null,
  };
};
