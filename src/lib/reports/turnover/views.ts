/**
 * Saved views of the turnover report (WRK-I12): `people_views` rows with
 * kind «turnover». A view saved on a preset (último trimestre…) keeps it
 * relative, so «Almacén trimestral» always opens the last closed quarter; a
 * custom range keeps its dates. Personal, or shared read-only with the
 * company; only the owner deletes it.
 */

import { and, asc, count, desc, eq, or } from "drizzle-orm";
import { z } from "zod";

import { tdb } from "@/lib/db";
import { peopleViews, users } from "@/lib/db/schema";
import { withTenant } from "@/lib/tenant/scope";

import { turnoverFilterSchema, type TurnoverFilter } from "./schema";
import {
  presetOf,
  presetRange,
  TURNOVER_PRESETS,
  type TurnoverPreset,
} from "./url";

export const MAX_TURNOVER_VIEWS_PER_USER = 50;
export const MAX_TURNOVER_VIEW_NAME = 80;

const storedSchema = z.object({
  preset: z.enum(TURNOVER_PRESETS).nullable().default(null),
  filter: turnoverFilterSchema,
});

export type TurnoverViewSummary = {
  id: string;
  name: string;
  shared: boolean;
  isOwner: boolean;
  ownerName: string | null;
  preset: TurnoverPreset | null;
  /** The filter to open, with a preset's range as of today. */
  filter: TurnoverFilter;
};

const ofTurnover = eq(peopleViews.kind, "turnover");

const visibleTo = (userId: string) =>
  or(eq(peopleViews.ownerUserId, userId), eq(peopleViews.shared, true));

const toSummary = (
  row: {
    id: string;
    name: string;
    shared: boolean;
    ownerUserId: string;
    ownerName: string | null;
    filter: unknown;
  },
  userId: string,
  today: string,
): TurnoverViewSummary | null => {
  const stored = storedSchema.safeParse(row.filter);

  if (!stored.success) return null;

  const { preset, filter } = stored.data;

  return {
    id: row.id,
    name: row.name,
    shared: row.shared,
    isOwner: row.ownerUserId === userId,
    ownerName: row.ownerName,
    preset,
    filter: preset ? { ...filter, ...presetRange(preset, today) } : filter,
  };
};

/** The user's views first, then the company's shared ones; by name. */
export const listTurnoverViews = async (
  companyId: string,
  userId: string,
  today: string,
) => {
  const rows = await tdb(companyId)
    .select({
      id: peopleViews.id,
      name: peopleViews.name,
      shared: peopleViews.shared,
      ownerUserId: peopleViews.ownerUserId,
      ownerName: users.name,
      filter: peopleViews.filter,
    })
    .from(peopleViews)
    .leftJoin(users, eq(peopleViews.ownerUserId, users.id))
    .where(withTenant(peopleViews, companyId, ofTurnover, visibleTo(userId)))
    .orderBy(
      desc(eq(peopleViews.ownerUserId, userId)),
      asc(peopleViews.name),
      asc(peopleViews.id),
    );

  return rows
    .map((row) => toSummary(row, userId, today))
    .filter((view): view is TurnoverViewSummary => view !== null);
};

export class TurnoverViewLimitError extends Error {
  constructor() {
    super(
      `Hasta ${MAX_TURNOVER_VIEWS_PER_USER} vistas del reporte por persona.`,
    );
    this.name = "TurnoverViewLimitError";
  }
}

/** Saves the filter; a preset range stays relative. */
export const createTurnoverView = async (
  companyId: string,
  userId: string,
  input: { name: string; shared: boolean; filter: TurnoverFilter },
  today: string,
) => {
  const [{ total }] = await tdb(companyId)
    .select({ total: count() })
    .from(peopleViews)
    .where(
      withTenant(
        peopleViews,
        companyId,
        ofTurnover,
        eq(peopleViews.ownerUserId, userId),
      ),
    );

  if (total >= MAX_TURNOVER_VIEWS_PER_USER) {
    throw new TurnoverViewLimitError();
  }

  const preset = presetOf(input.filter, today);
  const [row] = await tdb(companyId)
    .insert(peopleViews)
    .values({
      companyId,
      ownerUserId: userId,
      kind: "turnover",
      name: input.name.trim().slice(0, MAX_TURNOVER_VIEW_NAME),
      shared: input.shared,
      filter: {
        preset: preset === "custom" ? null : preset,
        filter: input.filter,
      },
    })
    .returning({ id: peopleViews.id });

  return row;
};

/** Only the owner, only in the company; false when nothing was deleted. */
export const deleteTurnoverView = async (
  companyId: string,
  userId: string,
  viewId: string,
) => {
  const rows = await tdb(companyId)
    .delete(peopleViews)
    .where(
      and(
        withTenant(
          peopleViews,
          companyId,
          ofTurnover,
          eq(peopleViews.id, viewId),
        ),
        eq(peopleViews.ownerUserId, userId),
      ),
    )
    .returning({ id: peopleViews.id });

  return rows.length > 0;
};
