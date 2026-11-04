/**
 * Saved views of the absenteeism and turnover report (W2-20): `people_views`
 * rows with kind «absenteeism» (migration 0050), like the turnover report's.
 * A view saved on a preset (último mes…) stays relative; a custom range keeps
 * its dates. Personal, or shared read-only with the company; only the owner
 * deletes it.
 */

import { and, asc, count, desc, eq, or } from "drizzle-orm";
import { z } from "zod";

import { tdb } from "@/lib/db";
import { peopleViews, users } from "@/lib/db/schema";
import { withTenant } from "@/lib/tenant/scope";

import {
  presetOf,
  presetRange,
  TURNOVER_PRESETS,
  type TurnoverPreset,
} from "../turnover/url";

import { absenteeismFilterSchema, type AbsenteeismFilter } from "./schema";

export const MAX_ABSENTEEISM_VIEWS_PER_USER = 50;
export const MAX_ABSENTEEISM_VIEW_NAME = 80;

const storedSchema = z.object({
  preset: z.enum(TURNOVER_PRESETS).nullable().default(null),
  filter: absenteeismFilterSchema,
});

export type AbsenteeismViewSummary = {
  id: string;
  name: string;
  shared: boolean;
  isOwner: boolean;
  ownerName: string | null;
  preset: TurnoverPreset | null;
  /** The filter to open, with a preset's range as of today. */
  filter: AbsenteeismFilter;
};

const ofAbsenteeism = eq(peopleViews.kind, "absenteeism");

const visibleTo = (userId: string) =>
  or(eq(peopleViews.ownerUserId, userId), eq(peopleViews.shared, true));

/** The user's views first, then the company's shared ones; by name. */
export const listAbsenteeismViews = async (
  companyId: string,
  userId: string,
  today: string,
): Promise<AbsenteeismViewSummary[]> => {
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
    .where(withTenant(peopleViews, companyId, ofAbsenteeism, visibleTo(userId)))
    .orderBy(
      desc(eq(peopleViews.ownerUserId, userId)),
      asc(peopleViews.name),
      asc(peopleViews.id),
    );

  return rows.flatMap((row) => {
    const stored = storedSchema.safeParse(row.filter);

    if (!stored.success) return [];

    const { preset, filter } = stored.data;

    return [
      {
        id: row.id,
        name: row.name,
        shared: row.shared,
        isOwner: row.ownerUserId === userId,
        ownerName: row.ownerName,
        preset,
        filter: preset ? { ...filter, ...presetRange(preset, today) } : filter,
      },
    ];
  });
};

export class AbsenteeismViewLimitError extends Error {
  constructor() {
    super(
      `Hasta ${MAX_ABSENTEEISM_VIEWS_PER_USER} vistas del reporte por persona.`,
    );
    this.name = "AbsenteeismViewLimitError";
  }
}

/** Saves the filter; a preset range stays relative. */
export const createAbsenteeismView = async (
  companyId: string,
  userId: string,
  input: { name: string; shared: boolean; filter: AbsenteeismFilter },
  today: string,
) => {
  const [{ total }] = await tdb(companyId)
    .select({ total: count() })
    .from(peopleViews)
    .where(
      withTenant(
        peopleViews,
        companyId,
        ofAbsenteeism,
        eq(peopleViews.ownerUserId, userId),
      ),
    );

  if (total >= MAX_ABSENTEEISM_VIEWS_PER_USER) {
    throw new AbsenteeismViewLimitError();
  }

  const preset = presetOf(input.filter, today);
  const [row] = await tdb(companyId)
    .insert(peopleViews)
    .values({
      companyId,
      ownerUserId: userId,
      kind: "absenteeism",
      name: input.name.trim().slice(0, MAX_ABSENTEEISM_VIEW_NAME),
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
export const deleteAbsenteeismView = async (
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
          ofAbsenteeism,
          eq(peopleViews.id, viewId),
        ),
        eq(peopleViews.ownerUserId, userId),
      ),
    )
    .returning({ id: peopleViews.id });

  return rows.length > 0;
};
