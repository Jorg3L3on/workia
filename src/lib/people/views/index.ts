/**
 * Saved views of the Personas list (Iniciativa 3). A view is a filter plus
 * the visible columns, owned by one user of one company; `shared` makes it
 * visible (read only) to every member of that company. Only the owner
 * changes or deletes it.
 *
 * Saving keeps what the owner chose; reading drops what the reader may not
 * see (contract fields and columns, payroll columns), so a shared view never
 * exposes salaries to someone without compensation:read.
 */

import { and, asc, count, desc, eq, or } from "drizzle-orm";

import { tdb } from "@/lib/db";
import { peopleViews, users } from "@/lib/db/schema";
import { withTenant } from "@/lib/tenant/scope";

import { coercePeopleColumns, type PeopleColumnId } from "../filter/columns";
import {
  coercePeopleFilter,
  restrictPeopleFilter,
  type PeopleFilter,
} from "../filter/schema";

/** Who reads or writes: the user and their permissions in the company. */
export type PeopleViewActor = {
  userId: string;
  permissions: ReadonlySet<string>;
};

export type PeopleViewInput = {
  name: string;
  filter: unknown;
  columns: unknown;
  shared: boolean;
};

export const MAX_PEOPLE_VIEWS_PER_USER = 50;
export const MAX_PEOPLE_VIEW_NAME = 80;

/** Every column id is stored as chosen; permissions apply when read. */
const ALL_COLUMNS = new Set<string>(["contracts:read", "compensation:read"]);

export type PeopleViewSummary = {
  id: string;
  name: string;
  shared: boolean;
  isOwner: boolean;
  ownerName: string | null;
  filter: PeopleFilter;
  columns: PeopleColumnId[];
};

const viewSelection = {
  id: peopleViews.id,
  name: peopleViews.name,
  shared: peopleViews.shared,
  ownerUserId: peopleViews.ownerUserId,
  ownerName: users.name,
  filter: peopleViews.filter,
  columns: peopleViews.columns,
};

const toSummary = (
  row: {
    id: string;
    name: string;
    shared: boolean;
    ownerUserId: string;
    ownerName: string | null;
    filter: unknown;
    columns: unknown;
  },
  actor: PeopleViewActor,
): PeopleViewSummary => ({
  id: row.id,
  name: row.name,
  shared: row.shared,
  isOwner: row.ownerUserId === actor.userId,
  ownerName: row.ownerName,
  filter: restrictPeopleFilter(
    coercePeopleFilter(row.filter),
    actor.permissions,
  ),
  columns: coercePeopleColumns(row.columns, actor.permissions),
});

/** Visible to the actor: their own views and the company's shared ones. */
const visibleTo = (actor: PeopleViewActor) =>
  or(eq(peopleViews.ownerUserId, actor.userId), eq(peopleViews.shared, true));

/** Views of the Personas list only: the turnover report keeps its own (0027). */
const ofPersonas = eq(peopleViews.kind, "people");

/** The actor's views first, then the shared ones of others; by name. */
export const listPeopleViews = async (
  companyId: string,
  actor: PeopleViewActor,
) => {
  const rows = await tdb(companyId)
    .select(viewSelection)
    .from(peopleViews)
    .leftJoin(users, eq(peopleViews.ownerUserId, users.id))
    .where(withTenant(peopleViews, companyId, ofPersonas, visibleTo(actor)))
    .orderBy(
      desc(eq(peopleViews.ownerUserId, actor.userId)),
      asc(peopleViews.name),
      asc(peopleViews.id),
    );

  return rows.map((row) => toSummary(row, actor));
};

/** One view the actor may read in the company, or null. */
export const getPeopleView = async (
  companyId: string,
  actor: PeopleViewActor,
  viewId: string,
) => {
  const [row] = await tdb(companyId)
    .select(viewSelection)
    .from(peopleViews)
    .leftJoin(users, eq(peopleViews.ownerUserId, users.id))
    .where(
      withTenant(
        peopleViews,
        companyId,
        ofPersonas,
        eq(peopleViews.id, viewId),
        visibleTo(actor),
      ),
    )
    .limit(1);

  return row ? toSummary(row, actor) : null;
};

export class PeopleViewLimitError extends Error {
  constructor() {
    super(`Hasta ${MAX_PEOPLE_VIEWS_PER_USER} vistas por persona.`);
    this.name = "PeopleViewLimitError";
  }
}

const toValues = (input: PeopleViewInput) => ({
  name: input.name.trim().slice(0, MAX_PEOPLE_VIEW_NAME),
  filter: coercePeopleFilter(input.filter),
  columns: coercePeopleColumns(input.columns, ALL_COLUMNS),
  shared: input.shared,
});

export const createPeopleView = async (
  companyId: string,
  actor: PeopleViewActor,
  input: PeopleViewInput,
) => {
  const [{ total }] = await tdb(companyId)
    .select({ total: count() })
    .from(peopleViews)
    .where(
      withTenant(
        peopleViews,
        companyId,
        ofPersonas,
        eq(peopleViews.ownerUserId, actor.userId),
      ),
    );

  if (total >= MAX_PEOPLE_VIEWS_PER_USER) {
    throw new PeopleViewLimitError();
  }

  const [row] = await tdb(companyId)
    .insert(peopleViews)
    .values({ companyId, ownerUserId: actor.userId, ...toValues(input) })
    .returning({ id: peopleViews.id });

  return getPeopleView(companyId, actor, row.id);
};

/** Only the owner, only in the company; null when there is no such view. */
export const updatePeopleView = async (
  companyId: string,
  actor: PeopleViewActor,
  viewId: string,
  input: PeopleViewInput,
) => {
  const [row] = await tdb(companyId)
    .update(peopleViews)
    .set(toValues(input))
    .where(
      withTenant(
        peopleViews,
        companyId,
        ofPersonas,
        eq(peopleViews.id, viewId),
        eq(peopleViews.ownerUserId, actor.userId),
      ),
    )
    .returning({ id: peopleViews.id });

  return row ? getPeopleView(companyId, actor, row.id) : null;
};

/** Only the owner, only in the company; false when nothing was deleted. */
export const deletePeopleView = async (
  companyId: string,
  actor: PeopleViewActor,
  viewId: string,
) => {
  const rows = await tdb(companyId)
    .delete(peopleViews)
    .where(
      and(
        withTenant(
          peopleViews,
          companyId,
          ofPersonas,
          eq(peopleViews.id, viewId),
        ),
        eq(peopleViews.ownerUserId, actor.userId),
      ),
    )
    .returning({ id: peopleViews.id });

  return rows.length > 0;
};
