"use server";

import { isoToday } from "@/lib/format/date";

import { requirePeopleRead } from "../auth";
import { countPeopleFiltered, countPeopleFilterOptions } from "../list";
import { PEOPLE_FILTER_FIELD_IDS, type PeopleFilterFieldId } from "./fields";
import { peopleFilterContext } from "./query";
import { coercePeopleFilter } from "./schema";

const session = async () => {
  try {
    return await requirePeopleRead();
  } catch {
    return null;
  }
};

/**
 * «Ver N personas» of the mobile sheet: how many people a filter that is not
 * applied yet would show. Without people:read, 0.
 */
export const countPeopleFilterAction = async (
  filter: unknown,
): Promise<number> => {
  const current = await session();

  if (!current) return 0;

  return countPeopleFiltered(
    current.companyId,
    coercePeopleFilter(filter),
    peopleFilterContext(current.permissions, isoToday()),
  );
};

/** People per option of one field under the rest of the filter (chip and sheet counts). */
export const countPeopleFilterOptionsAction = async (
  filter: unknown,
  field: PeopleFilterFieldId,
): Promise<Record<string, number>> => {
  const current = await session();

  if (!current || !PEOPLE_FILTER_FIELD_IDS.includes(field)) return {};

  return countPeopleFilterOptions(
    current.companyId,
    coercePeopleFilter(filter),
    peopleFilterContext(current.permissions, isoToday()),
    field,
  );
};
