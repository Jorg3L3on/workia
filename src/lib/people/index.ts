import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { people } from "@/lib/db/schema";
import type { PersonStatus } from "@/lib/db/schema/people";

import type { PersonFormValues } from "./schema";

export type ListPeopleOptions = {
  query?: string;
  status?: PersonStatus;
};

export const listPeople = async (options: ListPeopleOptions = {}) => {
  const { query, status } = options;

  const filters = [];

  if (query?.trim()) {
    const pattern = `%${query.trim()}%`;
    filters.push(
      or(
        ilike(people.givenName, pattern),
        ilike(people.familyName, pattern),
        ilike(people.email, pattern),
      ),
    );
  }

  if (status) {
    filters.push(eq(people.status, status));
  }

  const whereClause =
    filters.length === 0
      ? undefined
      : filters.length === 1
        ? filters[0]
        : and(...filters);

  return db
    .select()
    .from(people)
    .where(whereClause)
    .orderBy(
      desc(people.updatedAt),
      asc(people.familyName),
      asc(people.givenName),
    );
};

export const getPersonById = async (id: string) => {
  const [person] = await db
    .select()
    .from(people)
    .where(eq(people.id, id))
    .limit(1);

  return person ?? null;
};

export const createPerson = async (input: PersonFormValues) => {
  const [created] = await db
    .insert(people)
    .values({
      givenName: input.givenName,
      familyName: input.familyName,
      email: input.email?.trim() ? input.email.trim() : null,
      status: input.status,
    })
    .returning();

  return created;
};

export const updatePerson = async (id: string, input: PersonFormValues) => {
  const [updated] = await db
    .update(people)
    .set({
      givenName: input.givenName,
      familyName: input.familyName,
      email: input.email?.trim() ? input.email.trim() : null,
      status: input.status,
    })
    .where(eq(people.id, id))
    .returning();

  return updated ?? null;
};

export const countPeopleByStatus = async () => {
  const rows = await db
    .select({
      status: people.status,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(people)
    .groupBy(people.status);

  return rows.reduce<Record<PersonStatus, number>>(
    (accumulator, row) => {
      accumulator[row.status] = row.count;
      return accumulator;
    },
    { activa: 0, baja: 0 },
  );
};

export const countActivePeople = async () => {
  const counts = await countPeopleByStatus();
  return counts.activa;
};
